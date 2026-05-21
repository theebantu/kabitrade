const fs = require('fs');
const { MongoClient } = require('mongodb');

const STORE_COLLECTION = 'app_data';
let client = null;
let db = null;
let useMongo = false;
let filePaths = {};

async function getFromMongo(key) {
  const doc = await db.collection(STORE_COLLECTION).findOne({ _id: key });
  return doc?.items ?? null;
}

async function setToMongo(key, items) {
  await db.collection(STORE_COLLECTION).updateOne(
    { _id: key },
    { $set: { items, updatedAt: new Date() } },
    { upsert: true }
  );
}

function readJsonFromDisk(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return [];
  }
}

function writeJsonToDisk(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

async function init(paths) {
  filePaths = paths;
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.log('⚠️  MONGODB_URI not set — using local JSON files (data resets on cloud deploy/restart)');
    for (const filePath of Object.values(paths)) {
      if (!fs.existsSync(filePath)) {
        const dir = require('path').dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify([]));
      }
    }
    return 'file';
  }

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(process.env.MONGODB_DB_NAME || 'kabitrade');
  useMongo = true;

  for (const [key, filePath] of Object.entries(paths)) {
    let items = await getFromMongo(key);

    if (!items || items.length === 0) {
      const local = readJsonFromDisk(filePath);
      if (local.length > 0) {
        items = local;
        await setToMongo(key, items);
        console.log(`✅ Migrated ${key} from local file to MongoDB`);
      } else {
        items = [];
        await setToMongo(key, items);
      }
    }
  }

  console.log('✅ Connected to MongoDB — accounts and posts persist across restarts');
  return 'mongo';
}

async function get(key) {
  if (useMongo) {
    const items = await getFromMongo(key);
    return items || [];
  }
  return readJsonFromDisk(filePaths[key]);
}

async function set(key, data) {
  if (useMongo) {
    await setToMongo(key, data);
    return;
  }
  writeJsonToDisk(filePaths[key], data);
}

function isMongo() {
  return useMongo;
}

function getDb() {
  return db;
}

async function close() {
  if (client) await client.close();
}

module.exports = { init, get, set, isMongo, getDb, close };
