'use strict';

/**
 * End-to-end check against a running server. Start it first (`npm start`),
 * then: node smoke-test.js
 *
 * Uses the same real credentials your .env seeded, and cleans up after itself.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const BASE = 'http://127.0.0.1:' + (Number(process.env.PORT) || 3000);
const USER = process.env.ADMIN_USERNAME;
const PASS = process.env.ADMIN_PASSWORD;
const FLOURISH_GALLERY = 'smoke-test-flourish';
const INSPIRATION_GALLERY = 'smoke-test-inspiration';

let cookie = '';
let passed = 0;

async function call(method, url, options = {}) {
  const headers = Object.assign({}, options.headers);
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + url, { method, headers, body: options.body, redirect: 'manual' });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookie) cookie = c.split(';')[0];
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* html or empty */ }
  return { status: res.status, json, text, headers: res.headers, setCookie };
}

function check(label, condition, detail) {
  if (!condition) throw new Error(`FAIL  ${label}${detail ? ': ' + detail : ''}`);
  passed += 1;
  console.log(`  ok  ${label}`);
}

// A tiny valid 2x2 JPEG, so multer's mime sniffing sees a real image.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAACAAIBAREA/8QAHwAAAQUBAQEB' +
  'AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1Fh' +
  'ByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZ' +
  'WmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
  'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+v//Z',
  'base64'
);

function multipart(caption, note) {
  const boundary = '----nibwings' + Date.now();
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="note"\r\n\r\n${note || ''}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="image"; filename="../../evil.jpg"\r\n` +
    `Content-Type: image/jpeg\r\n\r\n`
  );
  const between = Buffer.from(
    `\r\n--${boundary}\r\n` +
    `Content-Disposition: form-data; name="preview"; filename="preview.jpg"\r\n` +
    `Content-Type: image/jpeg\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
    body: Buffer.concat([head, JPEG, between, JPEG, tail])
  };
}

(async () => {
  console.log('\nPUBLIC / UNAUTHENTICATED');
  let r = await call('GET', '/api/me');
  check('GET /api/me reports logged out', r.status === 200 && r.json.loggedIn === false, JSON.stringify(r.json));

  r = await call('GET', `/api/galleries/${FLOURISH_GALLERY}/images`);
  check('GET gallery images is public', r.status === 200 && Array.isArray(r.json), JSON.stringify(r.json));

  r = await call('POST', `/api/galleries/${FLOURISH_GALLERY}/images`, multipart('sneaky', ''));
  check('POST upload rejected when logged out', r.status === 401, 'got ' + r.status);

  r = await call('DELETE', '/api/images/anything');
  check('DELETE rejected when logged out', r.status === 401, 'got ' + r.status);

  r = await call('GET', '/api/galleries/..%2F..%2Fetc/images');
  check('bad gallery key rejected', r.status === 400, 'got ' + r.status);

  r = await call('GET', '/');
  check('serves public/index.html', r.status === 200 && r.text.includes('Nib &amp; Wings'));

  console.log('\nLOGIN');
  const badLogin = await call('POST', '/api/login', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: 'wrong-password' })
  });
  check('wrong password rejected', badLogin.status === 401, 'got ' + badLogin.status);

  r = await call('POST', '/api/login', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS })
  });
  check('correct password accepted', r.status === 200 && r.json.loggedIn === true, JSON.stringify(r.json));
  check('session cookie is httpOnly', r.setCookie.some(c => /httponly/i.test(c)), r.setCookie.join(''));
  check('session cookie is sameSite=lax', r.setCookie.some(c => /samesite=lax/i.test(c)), r.setCookie.join(''));
  check('session cookie not secure in dev', !r.setCookie.some(c => /;\s*secure/i.test(c)), r.setCookie.join(''));

  r = await call('GET', '/api/me');
  check('GET /api/me reports logged in', r.json.loggedIn === true && r.json.username === USER, JSON.stringify(r.json));

  console.log('\nUPLOAD / READ / DELETE');
  r = await call('POST', `/api/galleries/${FLOURISH_GALLERY}/images`, multipart('first swan attempt', 'Copied the tail from an 1890s Spencerian plate.'));
  check('upload accepted', r.status === 201, r.status + ' ' + r.text.slice(0, 200));
  const created = r.json;
  check('response includes preview and original URLs',
    created.id && created.url && created.originalUrl && created.url !== created.originalUrl &&
      created.caption === 'first swan attempt' && created.date,
    JSON.stringify(created));
  check('note round-trips', created.note === 'Copied the tail from an 1890s Spencerian plate.', JSON.stringify(created.note));
  check('traversal filename neutralised', !created.url.includes('..') && !created.url.includes('evil'), created.url);

  const onDisk = path.join(__dirname, 'uploads', path.basename(created.url));
  const originalOnDisk = path.join(__dirname, 'uploads', path.basename(created.originalUrl));
  check('preview and original written to uploads/', fs.existsSync(onDisk) && fs.existsSync(originalOnDisk));

  r = await call('GET', created.url);
  check('preview served over HTTP', r.status === 200);
  r = await call('GET', created.originalUrl);
  check('original served over HTTP', r.status === 200);

  // Second upload, to prove ordering.
  await new Promise(res => setTimeout(res, 10));
  const second = (await call('POST', `/api/galleries/${FLOURISH_GALLERY}/images`, multipart('second attempt', ''))).json;
  const other = (await call('POST', `/api/galleries/${INSPIRATION_GALLERY}/images`, multipart('Spencerian bird, 1890s plate', 'Found it in a scan of an old penmanship manual.'))).json;

  r = await call('GET', `/api/galleries/${FLOURISH_GALLERY}/images`);
  check('gallery filtered by key', r.json.length === 2, JSON.stringify(r.json.map(i => i.caption)));
  check('newest first', r.json[0].id === second.id, JSON.stringify(r.json.map(i => i.caption)));

  r = await call('GET', `/api/galleries/${INSPIRATION_GALLERY}/images`);
  check('inspiration gallery is separate', r.json.length === 1 && r.json[0].id === other.id);
  check('inspiration note stored', r.json[0].note === 'Found it in a scan of an old penmanship manual.', JSON.stringify(r.json[0]));

  console.log('\nCLEANUP + LOGOUT');
  for (const item of [created, second, other]) {
    r = await call('DELETE', '/api/images/' + item.id);
    check('deleted ' + item.caption, r.status === 200);
  }
  check('preview and original removed from disk', !fs.existsSync(onDisk) && !fs.existsSync(originalOnDisk));

  r = await call('DELETE', '/api/images/' + created.id);
  check('deleting a missing id is 404', r.status === 404, 'got ' + r.status);

  r = await call('GET', `/api/galleries/${FLOURISH_GALLERY}/images`);
  check('gallery empty again', r.json.length === 0);

  r = await call('POST', '/api/logout');
  check('logout succeeds', r.status === 200 && r.json.loggedIn === false);

  r = await call('GET', '/api/me');
  check('session gone after logout', r.json.loggedIn === false);

  r = await call('POST', `/api/galleries/${FLOURISH_GALLERY}/images`, multipart('after logout', ''));
  check('upload rejected again after logout', r.status === 401, 'got ' + r.status);

  console.log(`\n${passed} checks passed.\n`);
})().catch(err => {
  console.error('\n' + err.message + '\n');
  process.exit(1);
});
