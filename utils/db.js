import mongodb from 'mongodb';

class DBClient {
  constructor() {
    const host = process.env.DB_HOST || 'localhost';
    const port = process.env.DB_PORT || 27017;
    const database = process.env.DB_DATABASE || 'files_manager';

    this.client = new mongodb.MongoClient(
      `mongodb://${host}:${port}/${database}`, { useUnifiedTopology: true },
    );
    this.client.connect();
  }

  isAlive() {
    return this.client.isConnected();
  }

  async nbUsers() {
    return this.client.db().collection('users').estimatedDocumentCount();
  }

  async nbFiles() {
    return this.client.db().collection('files').estimatedDocumentCount();
  }
}

const dbClient = new DBClient();
export default dbClient;
