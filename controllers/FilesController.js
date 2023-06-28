import { ObjectId } from 'mongodb';
import { promisify } from 'util';
import { mkdir, writeFile /* stat, existsSync, realpath */ } from 'fs';
import { join as joinPath } from 'path';
import { tmpdir } from 'os';
import { v4 } from 'uuid';
import redisClient from '../utils/redis';
import dbClient from '../utils/db';

const FILE_TYPES = ['folder', 'file', 'image'];
const DEFAULT_PARENT_ID = 0; // ROOT_FOLDER_ID
const DEFAULT_ROOT_FOLDER = 'files_manager';

const { FOLDER_PATH = '' } = process.env;
const mkDirAsync = promisify(mkdir);
const writeFileAsync = promisify(writeFile);
// const statAsync = promisify(stat);
// const realpathAsync = promisify(realpath);

const baseDir = FOLDER_PATH.trim().length > 0
  ? FOLDER_PATH.trim()
  : joinPath(tmpdir(), DEFAULT_ROOT_FOLDER);

function isValidObjectId(id) {
  if (ObjectId.isValid(id)) {
    return String(new ObjectId(id)) === id;
  }
  return false;
}

class FilesController {
  /* eslint-disable consistent-return */
  static async postUpload(req, res) {
    const {
      name, type, parentId = DEFAULT_PARENT_ID, isPublic = false, data = '',
    } = req.body;
    const token = req.header('X-Token');
    const key = `auth_${token}`;
    const userId = await redisClient.get(key);
    if (userId) {
      const users = await dbClient.users();
      const idObject = new ObjectId(userId);
      users.findOne({ _id: idObject }, async (err, user) => {
        if (user) {
          // user is authenticated now;
          // validateFields(res, next, name, type, data);
          if (!name) {
            return res.status(400).send({ error: 'Missing name' });
          }
          if (!type || !FILE_TYPES.includes(type)) {
            return res.status(400).send({ error: 'Missing type' });
          }
          if (!data && type !== 'folder') {
            return res.status(400).send({ error: 'Missing data' });
          }
          if (parentId !== DEFAULT_PARENT_ID
              || parentId.toString() !== DEFAULT_PARENT_ID.toString()) {
            const parent = await (await dbClient.files()).findOne({
              _id: new ObjectId(isValidObjectId(parentId) ? parentId : Buffer.alloc(24, '0').toString('utf-8')),
            });

            if (!parent) {
              return res.status(400).send({ error: 'Parent not found' });
            }
            if (parent.type !== 'folder') {
              return res.status(400).send({ error: 'Parent is not a folder' });
            }
          }
          // if headers have not been sent because the `validateFields` has modified the headers
          await mkDirAsync(baseDir, { recursive: true });
          const tmpFile = {
            userId: new ObjectId(userId),
            name,
            type,
            isPublic,
            parentId: parentId === 0 ? '0' : new ObjectId(parentId),
          };
          if (type !== 'folder') {
            const localPath = joinPath(baseDir, v4());
            await writeFileAsync(localPath, Buffer.from(data, 'base64'));
            tmpFile.localPath = localPath;
          }
          const _file = await (await dbClient.files())
            .insertOne(tmpFile);
          if (!res.headersSent) {
            res.status(201).send({
              id: _file.insertedId.toString(),
              userId,
              name,
              type,
              isPublic,
              parentId: parentId === 0 ? 0 : new ObjectId(parentId),
            });
          }
        } else {
          return res.status(401).send({ error: 'Unauthorized' });
        }
      });
    } else {
      return res.status(401).send({ error: 'Unauthorized' });
    }
  }
}

module.exports = FilesController;
