/* eslint-disable */
import sha1 from 'sha1';
import { ObjectId } from 'mongodb';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

export default class UsersController {
  static async postNew(req, res) {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
    });
    req.on("end", async() => {
      const buffer = Buffer.concat(chunks);
      const stringData = buffer.toString();
      const dataObj = JSON.parse(stringData);
      // const { email, password } = req.body;
      const { email, password } = dataObj;
      if (email === undefined) {
        res.status(400).send({ error: 'Missing email' });
        return;
      }
      if (password === undefined) {
        res.status(400).send({ error: 'Missing password' });
        return;
      }

      if (email) {
        const user = await (await dbClient.users()).findOne({ email });
        if (user) {
          res.status(400).send({ error: 'Already exist' });
          return;
        }
        const thisUser = await (await dbClient.users())
            .insertOne({ email, password: sha1(password) });
        res.status(201).send({ email, id: thisUser.insertedId.toString() });
      }
    });

  }

  static async getMe(req, res) {
    const token = req.header('X-Token');
    const key = `auth_${token}`;
    const userId = await redisClient.get(key);
    if (userId) {
      const users = await dbClient.users();
      const idObject = new ObjectId(userId);
      users.findOne({ _id: idObject }, (err, user) => {
        if (user) {
          res.status(200).send({ id: userId, email: user.email });
        } else {
          res.status(401).send({ error: 'Unauthorized' });
        }
      });
    } else {
      res.status(401).send({ error: 'Unauthorized' });
    }
  }

  static async getUser(req, res) {
    const token = req.header('X-Token');
    const key = `auth_${token}`;
    const userId = await redisClient.get(key);
    if (userId) {
      const users = await dbClient.users();
      const idObject = new ObjectId(userId);
      users.findOne({ _id: idObject }, (err, user) => {
        if (user) {
          return user;
          // res.status(200).send({ id: userId, email: user.email });
        } else {
          return null
          res.status(401).send({ error: 'Unauthorized' });
        }
      });
    } else {
      res.status(401).send({ error: 'Unauthorized' });
    }
  }
}
