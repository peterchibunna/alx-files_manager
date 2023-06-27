/* eslint-disable import/no-named-as-default */
import v4 from 'uuid';
import redisClient from '../utils/redis';

class AuthController {
  static async getConnect(req, res) {
    const { user } = req;
    const token = v4();

    await redisClient.set(`auth_${token}`, user._id.toString(), 60 * 60 * 24);
    res.sendStatus(200);
    res.json({ token });
  }

  static async getDisconnect(req, res) {
    const token = req.headers['x-token'];

    await redisClient.del(`auth_${token}`);
    res.sendStatus(204);
    res.send();
  }
}

module.exports = AuthController;
