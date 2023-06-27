import sha1 from 'sha1';
import dbClient from '../utils/db';

class UsersController {
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
      const thisUser = await (await dbClient.users()).insertOne({ email, password: sha1(password) });
      res.status(201).send({ email, id: thisUser.insertedId.toString() });
      return;
    }
    res.send('Hello World');
  }
}

module.exports = UsersController;
