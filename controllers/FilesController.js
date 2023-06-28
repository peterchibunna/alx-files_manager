import { ObjectId } from 'mongodb';
import { promisify } from 'util';
import { mkdir, promises, writeFile } from 'fs';
import { join as joinPath } from 'path';
import { tmpdir } from 'os';
import { v4 } from 'uuid';
import mime from 'mime-types';
import redisClient from '../utils/redis';
import dbClient from '../utils/db';

const FILE_TYPES = ['folder', 'file', 'image'];
const DEFAULT_PARENT_ID = 0;
const DEFAULT_ROOT_FOLDER = 'files_manager';

const { FOLDER_PATH = '' } = process.env;
const mkDirAsync = promisify(mkdir);
const writeFileAsync = promisify(writeFile);

const NULL_OBJECT_ID = Buffer.alloc(24, '0').toString('utf-8');

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
  static async getShow(req, res) {
    const { id = NULL_OBJECT_ID } = req.params;
    const token = req.header('X-Token');
    const key = `auth_${token}`;
    const userId = await redisClient.get(key);
    let user = null;
    if (userId) {
      const users = await dbClient.users();
      const idObject = new ObjectId(userId);
      user = await users.findOne({ _id: idObject });
      if (user) {
        const files = await dbClient.files();
        const file = await files.findOne({
          _id: new ObjectId(isValidObjectId(id) ? id : NULL_OBJECT_ID),
          userId: new ObjectId(isValidObjectId(userId) ? userId : NULL_OBJECT_ID),
        });

        if (!file) {
          return res.status(404).send({ error: 'Not found' });
        }
        const {
          name, type, isPublic, parentId,
        } = file;
        return res.status(200).send({
          id, userId, name, type, isPublic, parentId: parentId === '0' ? 0 : parentId,
        });
      }
    }
    return res.status(401).send({ error: 'Unauthorized' });
  }

  static async getIndex(req, res) {
    // const {user} = req;
    const { parentId = DEFAULT_PARENT_ID, page = 0 } = req.query;
    const PAGE_SIZE = 20;
    const token = req.header('X-Token');
    const key = `auth_${token}`;
    const userId = await redisClient.get(key);
    if (userId) {
      const users = await dbClient.users();
      const idObject = new ObjectId(userId);
      const user = await users.findOne({ _id: idObject });
      if (user) {
        const _searchFilter = {
          userId: idObject,
        };
        if (parentId !== DEFAULT_PARENT_ID && isValidObjectId(parentId)) {
          _searchFilter.parentId = ObjectId(parentId);
        }
        const _files = await dbClient.files();
        const files = await _files.aggregate([
          { $match: _searchFilter },
          { $limit: PAGE_SIZE },
          { $skip: PAGE_SIZE * page },
          { $sort: { _id: -1 } },
          {
            $project: {
              _id: 0,
              id: '$_id',
              userId: '$userId',
              name: '$name',
              type: '$type',
              isPublic: '$isPublic',
              parentId: {
                $cond: { if: { $eq: ['$parentId', '0'] }, then: 0, else: '$parentId' },
              },
            },
          },
        ]).toArray();
        return res.status(200).send(files);
      }
    }
    return res.status(401).send({ error: 'Unauthorized' });
  }

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
              _id: new ObjectId(isValidObjectId(parentId) ? parentId : NULL_OBJECT_ID),
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

  static async getUser(req) {
    const token = req.header('X-Token');
    const key = `auth_${token}`;
    const userId = await redisClient.get(key);

    if (userId) {
      const users = await dbClient.users();
      const idObject = new ObjectId(userId);
      /* eslint-disable-next-line no-return-await */
      return await users.findOne({ _id: idObject });
    }
    return null;
  }

  static async putPublish(req, res) {
    const user = await FilesController.getUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { id } = req.params;
    const files = await dbClient.files();
    const idObject = new ObjectId(id);
    const newVal = { $set: { isPublic: true } };
    const options = { returnDocument: false };
    files.findOneAndUpdate({ _id: idObject, userId: user._id }, newVal, options, (err, file) => {
      if (!file.lastErrorObject.updatedExisting) {
        return res.status(404).send({ error: 'Not found' });
      }
      const {
        userId, _id, name, type, isPublic, parentId,
      } = file.value;
      return res.status(200).send({
        id: _id,
        userId,
        name,
        type,
        isPublic,
        parentId: parentId === DEFAULT_PARENT_ID.toString()
          ? 0
          : parentId.toString(),
      });
    });
    return null;
  }

  static async putUnpublish(req, res) {
    const user = await FilesController.getUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { id } = req.params;
    const files = await dbClient.files();
    const idObject = new ObjectId(id);
    const newVal = { $set: { isPublic: false } };
    const options = { returnOriginal: false };
    files.findOneAndUpdate({ _id: idObject, userId: user._id }, newVal, options, (err, file) => {
      if (!file.lastErrorObject.updatedExisting) {
        return res.status(404).json({ error: 'Not found' });
      }
      const {
        userId, _id, name, type, isPublic, parentId,
      } = file.value;
      return res.status(200).send({
        id: _id,
        userId,
        name,
        type,
        isPublic,
        parentId: parentId === DEFAULT_PARENT_ID.toString()
          ? 0
          : parentId.toString(),
      });
    });
    return null;
  }

  static async getFile(req, res) {
    const { id } = req.params;
    const files = dbClient.files();
    const idObject = new ObjectId(id);
    files.findOne({ _id: idObject }, async (err, file) => {
      if (!file) {
        return res.status(404).json({ error: 'Not found' });
      }
      console.log(file.localPath);
      if (file.isPublic) {
        if (file.type === 'folder') {
          return res.status(400).json({ error: "A folder doesn't have content" });
        }
        try {
          let fileName = file.localPath;
          const size = req.param('size');
          if (size) {
            fileName = `${file.localPath}_${size}`;
          }
          const data = await promises.readFile(fileName);
          const contentType = mime.contentType(file.name);
          return res.header('Content-Type', contentType).status(200).send(data);
        } catch (error) {
          console.log(error);
          return res.status(404).json({ error: 'Not found' });
        }
      } else {
        const user = await FilesController.getUser(req);
        if (!user) {
          return res.status(404).json({ error: 'Not found' });
        }
        if (file.userId.toString() === user._id.toString()) {
          if (file.type === 'folder') {
            return res.status(400).json({ error: "A folder doesn't have content" });
          }
          try {
            let fileName = file.localPath;
            const size = req.param('size');
            if (size) {
              fileName = `${file.localPath}_${size}`;
            }
            const contentType = mime.contentType(file.name);
            return res.header('Content-Type', contentType).status(200).sendFile(fileName);
          } catch (error) {
            console.log(error);
            return res.status(404).json({ error: 'Not found' });
          }
        } else {
          console.log(`Wrong user: file.userId=${file.userId}; userId=${user._id}`);
          return res.status(404).json({ error: 'Not found' });
        }
      }
    });
  }
}

module.exports = FilesController;
