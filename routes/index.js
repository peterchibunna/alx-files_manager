import express from 'express';
import AppController from '../controllers/AppController';
import UsersController from '../controllers/UsersController';

const bodyParser = require('body-parser');
const router = express.Router();

router.get('/status', AppController.getStatus);
router.get('/stats', AppController.getStats);
router.post('/users', bodyParser.json(), UsersController.postNew);

module.exports = router;
