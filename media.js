const { getDb, isMongo } = require('./store');

async function saveUploadedFile(file) {
  if (!isMongo() || !file?.buffer) return null;

  const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  const db = getDb();
  await db.collection('media').insertOne({
    _id: id,
    data: file.buffer.toString('base64'),
    mimeType: file.mimetype,
    createdAt: new Date()
  });
  return `/api/media/${id}`;
}

async function getMediaFile(id) {
  if (!isMongo()) return null;
  const db = getDb();
  return db.collection('media').findOne({ _id: id });
}

module.exports = { saveUploadedFile, getMediaFile };
