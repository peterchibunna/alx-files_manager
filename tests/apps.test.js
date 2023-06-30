import {
  expect, use, should, request,
} from 'chai';
import chaiHttp from 'chai-http';
import app from '../server';
import dbClient from '../utils/db';
import {MongoClient, ObjectId} from "mongodb";
import sha1 from "sha1";
import redis from "redis";
import {promisify} from "util";
import {v4 as uuidv4} from "uuid";
import chai from 'chai';

use(chaiHttp);
should();

describe('testing Endpoints', () => {
  describe('GET /status', () => {
    it('returns the status of redis and mongo connection', async () => {
      const response = await request(app).get('/status').send();
      const body = JSON.parse(response.text);

      expect(body).to.eql({redis: true, db: true});
      expect(response.statusCode).to.equal(200);
    });
  });
  describe('GET /stats', () => {
    before(async () => {
      await dbClient.usersCollection.deleteMany({});
      await dbClient.filesCollection.deleteMany({});
    });

    it('returns number of users and files in db 0 for this one', async () => {
      const response = await request(app).get('/stats').send();
      const body = JSON.parse(response.text);

      expect(body).to.eql({users: 0, files: 0});
      expect(response.statusCode).to.equal(200);
    });

    it('returns number of users and files in db 1 and 2 for this one', async () => {
      await dbClient.usersCollection.insertOne({name: 'Larry'});
      await dbClient.filesCollection.insertOne({name: 'image.png'});
      await dbClient.filesCollection.insertOne({name: 'file.txt'});

      const response = await request(app).get('/stats').send();
      const body = JSON.parse(response.text);

      expect(body).to.eql({users: 1, files: 2});
      expect(response.statusCode).to.equal(200);
    });
  });
  describe('POST /users creates a new user in DB (when pass correct parameters)', () => {
    let testClientDb = null;

    const fctRandomString = () => {
      return Math.random().toString(36).substring(2, 15);
    }

    beforeEach(() => {
      const dbInfo = {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || '27017',
        database: process.env.DB_DATABASE || 'files_manager'
      };
      return new Promise((resolve) => {
        MongoClient.connect(`mongodb://${dbInfo.host}:${dbInfo.port}/${dbInfo.database}`, async (err, client) => {
          testClientDb = client.db(dbInfo.database);

          await testClientDb.collection('users').deleteMany({})

          resolve();
        });
      });
    });

    afterEach(() => {
    });

    it('GET /users creates a new user in DB (when pass correct parameters)', (done) => {
      const userParam = {
        email: `${fctRandomString()}@me.com`,
        password: `${fctRandomString()}`
      }
      chai.request('http://localhost:5000')
          .post('/users')
          .send(userParam)
          .end((err, res) => {
            chai.expect(err).to.be.null;
            chai.expect(res).to.have.status(201);
            const resUserId = res.body.id
            const resUserEmail = res.body.email
            chai.expect(resUserEmail).to.equal(userParam.email);

            testClientDb.collection('users')
                .find({})
                .toArray((err, docs) => {
                  chai.expect(err).to.be.null;
                  chai.expect(docs.length).to.equal(1);
                  chai.expect(docs[0]._id.toString()).to.equal(resUserId);
                  chai.expect(docs[0].email).to.equal(resUserEmail);
                  done();
                })
          });
    }).timeout(30000);
  });
  describe('POST /users with missing password', () => {
    let testClientDb = null;
    let initialUser = null;

    const fctRandomString = () => {
      return Math.random().toString(36).substring(2, 15);
    }

    beforeEach(() => {
      const dbInfo = {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || '27017',
        database: process.env.DB_DATABASE || 'files_manager'
      };
      return new Promise((resolve) => {
        MongoClient.connect(`mongodb://${dbInfo.host}:${dbInfo.port}/${dbInfo.database}`, async (err, client) => {
          testClientDb = client.db(dbInfo.database);

          await testClientDb.collection('users').deleteMany({})

          // Add 1 user
          initialUser = {
            email: `${fctRandomString()}@me.com`,
            password: sha1(fctRandomString())
          }
          await testClientDb.collection('users').insertOne(initialUser);

          resolve();
        });
      });
    });

    afterEach(() => {
    });

    it('GET /users with email that already exists', (done) => {
      const userParam = {
        email: initialUser.email,
        password: `${fctRandomString()}`
      }
      chai.request('http://localhost:5000')
          .post('/users')
          .send(userParam)
          .end((err, res) => {
            chai.expect(err).to.be.null;
            chai.expect(res).to.have.status(400);
            const resError = res.body.error;
            chai.expect(resError).to.equal("Already exist");

            testClientDb.collection('users')
                .find({})
                .toArray((err, docs) => {
                  chai.expect(err).to.be.null;
                  chai.expect(docs.length).to.equal(1);
                  const docUser = docs[0];
                  chai.expect(docUser.email).to.equal(initialUser.email);
                  chai.expect(docUser.password.toUpperCase()).to.equal(initialUser.password.toUpperCase());
                  done();
                })
          });
    }).timeout(30000);
  });
  describe('GET /users/me with correct token', () => {
    let testClientDb;
    let testRedisClient;
    let redisDelAsync;
    let redisGetAsync;
    let redisSetAsync;
    let redisKeysAsync;

    let initialUser = null;
    let initialUserId = null;
    let initialUserToken = null;

    const fctRandomString = () => {
      return Math.random().toString(36).substring(2, 15);
    }
    const fctRemoveAllRedisKeys = async () => {
      const keys = await redisKeysAsync('auth_*');
      keys.forEach(async (key) => {
        await redisDelAsync(key);
      });
    }

    beforeEach(() => {
      const dbInfo = {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || '27017',
        database: process.env.DB_DATABASE || 'files_manager'
      };
      return new Promise((resolve) => {
        MongoClient.connect(`mongodb://${dbInfo.host}:${dbInfo.port}/${dbInfo.database}`, async (err, client) => {
          testClientDb = client.db(dbInfo.database);

          await testClientDb.collection('users').deleteMany({})

          // Add 1 user
          initialUser = {
            email: `${fctRandomString()}@me.com`,
            password: sha1(fctRandomString())
          }
          const createdDocs = await testClientDb.collection('users').insertOne(initialUser);
          if (createdDocs && createdDocs.ops.length > 0) {
            initialUserId = createdDocs.ops[0]._id.toString();
          }

          testRedisClient = redis.createClient();
          redisDelAsync = promisify(testRedisClient.del).bind(testRedisClient);
          redisGetAsync = promisify(testRedisClient.get).bind(testRedisClient);
          redisSetAsync = promisify(testRedisClient.set).bind(testRedisClient);
          redisKeysAsync = promisify(testRedisClient.keys).bind(testRedisClient);
          testRedisClient.on('connect', async () => {
            fctRemoveAllRedisKeys();

            // Set token for this user
            initialUserToken = uuidv4()
            await redisSetAsync(`auth_${initialUserToken}`, initialUserId)
            resolve();
          });
        });
      });
    });

    afterEach(() => {
      fctRemoveAllRedisKeys();
    });

    it('GET /users/me with an correct token', (done) => {
      chai.request('http://localhost:5000')
          .get('/users/me')
          .set('X-Token', initialUserToken)
          .end(async (err, res) => {
            chai.expect(err).to.be.null;
            chai.expect(res).to.have.status(200);

            const resUser = res.body;
            chai.expect(resUser.email).to.equal(initialUser.email);
            chai.expect(resUser.id).to.equal(initialUserId);

            done();
          });
    }).timeout(30000);
  });
  describe('PUT /files/:id/publish', () => {
    let testClientDb;
    let testRedisClient;
    let redisDelAsync;
    let redisGetAsync;
    let redisSetAsync;
    let redisKeysAsync;

    let initialUser = null;
    let initialUserId = null;
    let initialUserToken = null;

    let initialFolder = null;
    let initialFolderId = null;

    const fctRandomString = () => {
      return Math.random().toString(36).substring(2, 15);
    }
    const fctRemoveAllRedisKeys = async () => {
      const keys = await redisKeysAsync('auth_*');
      keys.forEach(async (key) => {
        await redisDelAsync(key);
      });
    }

    beforeEach(() => {
      const dbInfo = {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || '27017',
        database: process.env.DB_DATABASE || 'files_manager'
      };
      return new Promise((resolve) => {
        MongoClient.connect(`mongodb://${dbInfo.host}:${dbInfo.port}/${dbInfo.database}`, async (err, client) => {
          testClientDb = client.db(dbInfo.database);

          await testClientDb.collection('users').deleteMany({})
          await testClientDb.collection('files').deleteMany({})

          // Add 1 user
          initialUser = {
            email: `${fctRandomString()}@me.com`,
            password: sha1(fctRandomString())
          }
          const createdDocs = await testClientDb.collection('users').insertOne(initialUser);
          if (createdDocs && createdDocs.ops.length > 0) {
            initialUserId = createdDocs.ops[0]._id.toString();
          }

          // Add 1 folder
          initialFolder = {
            userId: ObjectId(initialUserId),
            name: fctRandomString(),
            type: "folder",
            parentId: '0',
            isPublic: false
          };
          const createdFileDocs = await testClientDb.collection('files').insertOne(initialFolder);
          if (createdFileDocs && createdFileDocs.ops.length > 0) {
            initialFolderId = createdFileDocs.ops[0]._id.toString();
          }

          testRedisClient = redis.createClient();
          redisDelAsync = promisify(testRedisClient.del).bind(testRedisClient);
          redisGetAsync = promisify(testRedisClient.get).bind(testRedisClient);
          redisSetAsync = promisify(testRedisClient.set).bind(testRedisClient);
          redisKeysAsync = promisify(testRedisClient.keys).bind(testRedisClient);
          testRedisClient.on('connect', async () => {
            fctRemoveAllRedisKeys();

            // Set token for this user
            initialUserToken = uuidv4()
            await redisSetAsync(`auth_${initialUserToken}`, initialUserId)
            resolve();
          });
        });
      });
    });

    afterEach(() => {
      fctRemoveAllRedisKeys();
    });

    it('PUT /files/:id/publish with correct :id of the owner - file not published yet', (done) => {
      chai.request('http://localhost:5001')
          .put(`/files/${initialFolderId}/publish`)
          .set('X-Token', initialUserToken)
          .end(async (err, res) => {
            chai.expect(err).to.be.null;
            chai.expect(res).to.have.status(200);

            const resFile = res.body;
            chai.expect(resFile.name).to.equal(initialFolder.name);
            chai.expect(resFile.type).to.equal(initialFolder.type);
            chai.expect(resFile.isPublic).to.true
            chai.expect(resFile.parentId.toString()).to.equal(initialFolder.parentId.toString());
            chai.expect(resFile.userId.toString()).to.equal(initialFolder.userId.toString());

            done();
          });
    }).timeout(30000);
  });



});
