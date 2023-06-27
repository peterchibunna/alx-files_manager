import v4 from 'uuid';
import sha1 from 'sha1';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

class AuthController {
  static async getConnect(req, res) {
    const { authorization } = req.headers;
    if (!authorization) {
      res.status(401).json({ error: 'Unauthorized' });
      res.end();
      return;
    }

    const tokenType = authorization.substring(0, 6);
    if (!tokenType !== 'Basic') {
      res.status(401).json({ error: 'Unauthorized' });
      res.end();
      return;
    }
    const token = authorization.substring(6);

    const decodedToken = Buffer.from(token, 'base64').toString('utf8');
    if (!decodedToken.includes(':')) {
      res.status(401).json({ error: 'Unauthorized' });
      res.end();
      return;
    }

    const [email, password] = decodedToken.split(':');

    if (email && password) {
      const user = await (await dbClient.users()).findOne({ email });
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        res.end();
        return;
      }
      if (user.password !== sha1(password)) {
        res.status(401).json({ error: 'Unauthorized' });
        res.end();
        return;
      }
      const authToken = v4();
      await redisClient.set(
        `auth_${authToken}`,
        user._id.toString('utf8'),
        60 * 60 * 24,
      );
      res.json({ token: authToken });
      res.end();
    }
  }

  static async getDisconnect(req, res) {
    const token = req.headers['x-token'];
    if (!token) {
      res.sendStatus(401);
      res.json({ error: 'Unauthorized' });
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
    const user = await (await dbClient.users()).findOne({ id });
    if (!user) {
      res.sendStatus(401);
      res.json({ error: 'Unauthorized' });
      res.end();
      return;
    }
    await redisClient.del(`auth_${token}`);
    res.status(204).end();
  }
}

module.exports = AuthController;
