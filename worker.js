import Queue from 'bull';
import { ObjectId } from 'mongodb';
import { promises } from 'fs';
import Mailer from './utils/mailer';
import dbClient from './utils/db';

const imageThumbnail = require('image-thumbnail');

const fileQueue = new Queue('fileQueue');
const userQueue = new Queue('userQueue');

function isValidObjectId(id) {
  if (ObjectId.isValid(id)) {
    return String(new ObjectId(id)) === id;
  }
  return false;
}

// to delete bull keys in redis: `redis-cli keys "bull*" | xargs redis-cli del`

fileQueue.process(async (job) => {
  const { fileId, userId } = job.data;

  if (!userId) {
    console.log('Missing userId');
    throw new Error('Missing userId');
  }

  if (!fileId) {
    console.log('Missing fileId');
    throw new Error('Missing fileId');
  }

  if (!isValidObjectId(fileId) || !isValidObjectId(userId)) throw new Error('File not found');

  const file = await (await dbClient.files()).getFile({
    _id: ObjectId(fileId),
    userId: ObjectId(userId),
  });

  if (!file) throw new Error('File not found');

  const { localPath } = file;
  const widths = [500, 250, 100];

  await (async () => {
    // anonymous async function
    for (const width of widths) {
      try {
        /* eslint-disable no-await-in-loop */
        const thumbnail = await imageThumbnail(localPath, { width });
        /* eslint-disable no-await-in-loop */
        await promises.writeFile(`${localPath}_${width}`, thumbnail);
      } catch (err) {
        console.error(err.message);
      }
    }
  })();
});

userQueue.process(async (job, done) => {
  const { userId } = job.data;

  if (!userId) {
    throw new Error('Missing userId');
  }

  if (!isValidObjectId(userId)) {
    throw new Error('User not found');
  }

  const user = await (await dbClient.users()).getUser({
    _id: ObjectId(userId),
  });

  if (!user) {
    throw new Error('User not found');
  }

  console.log(`Welcome ${user.email}!`);
  try {
    const _subject = 'Project: ALX-Files_Manager';
    const _htmlContent = '<div><h2>Hello {{user.name}},</h2>'
        + 'Welcome to <b><a href="https://github.com/peterchibunna/alx-files_manager">'
        + 'ALX-Files_Manager</a></b>] - <br><br>'
        + 'This project is a summary of this back-end trimester: authentication, '
        + 'NodeJS, MongoDB, Redis, pagination and background processing. '
        + 'The objective is to build a simple platform to upload and view files:'
        + '<ul>'
        + '<li>User authentication via a token</li>\n'
        + '<li>List all files</li>\n'
        + '<li>Upload a new file</li>\n'
        + '<li>Change permission of a file</li>\n'
        + '<li>View a file</li>\n'
        + '<li>Generate thumbnails for images</li>'
        + '</ul>'
        + 'This is a team work by:'
        + '<ul><li>Peter Onwuzuruigbo </li><li>Clinton Mokaya</li></ul>'
        + '</div>';
    Mailer.sendMail(Mailer.buildMessage(user.email, _subject, _htmlContent));
    done();
  } catch (err) {
    done(err);
  }
});
