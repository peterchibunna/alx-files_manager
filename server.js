import express from 'express';
import router from './routes/index';

const server = express();
const PORT = process.env.PORT ? process.env.PORT : 5001;

server.use(router);

server.listen(PORT, () => {
  console.log(`server running on port ${PORT}`);
});

module.exports = server;
