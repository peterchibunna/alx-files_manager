import sha1 from 'sha1';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

export default class UsersController {
  static async postNew(req, res) {
    const { email, password } = req.body;
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
  }

  static async getMe(req, res) {
    const token = req.headers['x-token'];
    if (!token) {
      res.status(401).json({ error: 'Unauthorized' });
      res.end();
      return;
    }
    const id = await redisClient.get(`auth_${token}`);
    if (!id) {
      res.sendStatus(401);
      res.json({ error: 'Unauthorized' });
      res.end();
      return;
    }
    const user = await dbClient.getUserById(id);
    if (!user) {
      res.sendStatus(401);
      res.json({ error: 'Unauthorized' });
      res.end();
      return;
    }
    res.json({ id: user._id, email: user.email }).end();
  }
}
