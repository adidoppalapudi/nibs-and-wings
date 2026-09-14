'use strict';

/**
 * The entire "database layer". Two functions, no schema, no ORM.
 *
 * Writes go to a temp file first and are then renamed over the target. rename()
 * is atomic on the same filesystem, so a crash mid-write can never leave a
 * half-written images.json behind. You get either the old file or the new one.
 */

const fs = require('fs');
const path = require('path');

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    // Missing file on first run is expected; anything else is worth knowing about.
    if (err.code !== 'ENOENT') {
      console.error(`[store] could not read ${file}, using fallback:`, err.message);
    }
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

module.exports = { readJSON, writeJSON };
