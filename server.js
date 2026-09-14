'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');

const { readJSON, writeJSON } = require('./lib/store');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const IMAGES_FILE = path.join(DATA_DIR, 'images.json');

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (!process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const app = express();

// nginx terminates TLS, so secure cookies and req.ip only work behind trust proxy.
if (IS_PROD) app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

app.use(session({
  name: 'nw.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
  }
}));

/* ---------------------------------------------------------------
   Auth
   --------------------------------------------------------------- */

function requireAuth(req, res, next) {
  if (req.session && req.session.username) return next();
  res.status(401).json({ error: 'Not logged in' });
}

// Crude per-IP throttle so the one login route can't be ground through by a
// script. In-memory is fine here: one admin, one process.
const attempts = new Map();
const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

function loginThrottle(req, res, next) {
  const now = Date.now();
  const rec = attempts.get(req.ip);

  if (!rec || now > rec.resetAt) {
    attempts.set(req.ip, { count: 0, resetAt: now + ATTEMPT_WINDOW_MS });
  } else if (rec.count >= MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }

  // Keep the table from growing without bound on a long-lived process.
  if (attempts.size > 1000) {
    for (const [k, v] of attempts) if (now > v.resetAt) attempts.delete(k);
  }
  next();
}

app.post('/api/login', loginThrottle, (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const admin = readJSON(ADMIN_FILE, null);
  if (!admin || !admin.passwordHash) {
    return res.status(500).json({ error: 'No admin configured. Run `npm run seed`.' });
  }

  const userOk = username === admin.username;
  // Always run the bcrypt compare, so a wrong username is not measurably
  // faster than a wrong password.
  const passOk = bcrypt.compareSync(password, admin.passwordHash);

  if (!userOk || !passOk) {
    attempts.get(req.ip).count += 1;
    return res.status(401).json({ error: 'Wrong username or password' });
  }

  attempts.delete(req.ip);
  // Fresh session id on login, so a pre-set cookie value can't be reused.
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Could not start session' });
    req.session.username = admin.username;
    res.json({ loggedIn: true, username: admin.username });
  });
});

app.post('/api/logout', (req, res) => {
  if (!req.session) return res.json({ loggedIn: false });
  req.session.destroy(() => {
    res.clearCookie('nw.sid');
    res.json({ loggedIn: false });
  });
});

app.get('/api/me', (req, res) => {
  const username = req.session && req.session.username;
  res.json({ loggedIn: Boolean(username), username: username || null });
});

/* ---------------------------------------------------------------
   Uploads
   --------------------------------------------------------------- */

const ALLOWED_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    // Never reuse the client's filename. It would decide where bytes land on disk.
    filename: (req, file, cb) => {
      const stamp = Date.now().toString(36);
      const rand = crypto.randomBytes(5).toString('hex');
      cb(null, stamp + '-' + rand + (ALLOWED_MIME[file.mimetype] || '.bin'));
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 2, fields: 5 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME[file.mimetype]) return cb(null, true);
    cb(new Error('Only JPEG, PNG, WebP or GIF images are allowed.'));
  }
});

/* ---------------------------------------------------------------
   Galleries
   --------------------------------------------------------------- */

// A gallery key is just a label; keep it to safe characters so it can never be
// used to smuggle anything into a filename or a path.
const KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function readImages() {
  const list = readJSON(IMAGES_FILE, []);
  return Array.isArray(list) ? list : [];
}

function toPublic(row) {
  return {
    id: row.id,
    url: '/uploads/' + row.filename,
    // Older records have only filename; for those, the display image is also
    // the best full-size version available.
    originalUrl: '/uploads/' + (row.original_filename || row.filename),
    caption: row.caption || '',
    // The short line about what inspired the piece, or where it came from.
    note: row.note || '',
    date: row.created_at
  };
}

app.get('/api/galleries/:key/images', (req, res) => {
  const key = req.params.key;
  if (!KEY_RE.test(key)) return res.status(400).json({ error: 'Bad gallery key' });

  // ISO-8601 strings sort correctly as text, so no Date parsing needed.
  const images = readImages()
    .filter(row => row.gallery_key === key)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map(toPublic);

  res.json(images);
});

app.post('/api/galleries/:key/images', requireAuth, (req, res) => {
  const key = req.params.key;
  if (!KEY_RE.test(key)) return res.status(400).json({ error: 'Bad gallery key' });

  upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'preview', maxCount: 1 }
  ])(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({
        error: tooBig ? 'That image is over the 25 MB limit.' : err.message
      });
    }
    const original = req.files && req.files.image && req.files.image[0];
    const preview = req.files && req.files.preview && req.files.preview[0];
    if (!original) {
      // A malformed preview-only request must not leave an orphan on disk.
      if (preview) fs.unlink(preview.path, () => {});
      return res.status(400).json({ error: 'No image file received' });
    }

    const row = {
      id: crypto.randomUUID(),
      gallery_key: key,
      filename: preview ? preview.filename : original.filename,
      original_filename: original.filename,
      caption: String((req.body && req.body.caption) || '').trim().slice(0, 300),
      note: String((req.body && req.body.note) || '').trim().slice(0, 500),
      created_at: new Date().toISOString()
    };

    const images = readImages();
    images.push(row);
    writeJSON(IMAGES_FILE, images);

    res.status(201).json(toPublic(row));
  });
});

app.delete('/api/images/:id', requireAuth, (req, res) => {
  const images = readImages();
  const index = images.findIndex(row => row.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'No such image' });

  const [row] = images.splice(index, 1);
  writeJSON(IMAGES_FILE, images);

  // The record is the source of truth; a missing file shouldn't fail the request.
  const filenames = new Set([row.filename, row.original_filename].filter(Boolean));
  for (const filename of filenames) {
    fs.unlink(path.join(UPLOAD_DIR, path.basename(filename)), (err) => {
      if (err && err.code !== 'ENOENT') console.error('[delete] unlink failed:', err.message);
    });
  }

  res.json({ deleted: row.id });
});

/* ---------------------------------------------------------------
   Static files
   --------------------------------------------------------------- */

// Uploaded files never change once written, so they can cache hard.
app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: '365d',
  immutable: true,
  index: false,
  dotfiles: 'ignore'
}));

app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).sendFile(path.join(ROOT, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Something went wrong' });
});

// Bound to loopback only. nginx is the thing facing the internet.
app.listen(PORT, '127.0.0.1', () => {
  console.log('Nib & Wings listening on http://127.0.0.1:' + PORT + ' (' + (IS_PROD ? 'production' : 'development') + ')');
});
