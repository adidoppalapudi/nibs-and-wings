'use strict';

/**
 * One-off: turn ADMIN_USERNAME / ADMIN_PASSWORD from .env into data/admin.json.
 *
 *   npm run seed
 *
 * Safe to re-run. It overwrites the file, which is how you change your password:
 * edit .env, run it again, restart the server.
 */

require('dotenv').config();

const path = require('path');
const bcrypt = require('bcryptjs');
const { writeJSON } = require('./lib/store');

const ADMIN_FILE = path.join(__dirname, 'data', 'admin.json');

const username = (process.env.ADMIN_USERNAME || '').trim();
const password = process.env.ADMIN_PASSWORD || '';

if (!username || !password) {
  console.error('Set ADMIN_USERNAME and ADMIN_PASSWORD in .env first (see .env.example).');
  process.exit(1);
}

if (password.length < 8) {
  console.error('Pick a password of at least 8 characters.');
  process.exit(1);
}

if (password === 'change-me-before-seeding') {
  console.error('That is still the placeholder password from .env.example. Pick a real one.');
  process.exit(1);
}

writeJSON(ADMIN_FILE, {
  username,
  passwordHash: bcrypt.hashSync(password, 12)
});

console.log(`Wrote ${ADMIN_FILE} for user "${username}".`);
console.log('You can blank ADMIN_PASSWORD in .env now. The server only reads the hash.');
