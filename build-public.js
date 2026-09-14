'use strict';

/**
 * Generates public/index.html from nib-and-wings.html.
 *
 * Your original file is never modified. This only swaps the sandbox
 * `window.storage` data layer for the real API, adds a sign-in box, and hides
 * the uploader / delete button when nobody is signed in. Every replacement
 * below is asserted, so if you edit the source HTML and one of these snippets
 * no longer matches, this script fails loudly instead of silently skipping it.
 *
 *   npm run build
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'nib-and-wings.html');
const OUT = path.join(__dirname, 'public', 'index.html');

let html = fs.readFileSync(SRC, 'utf8');

function replace(label, find, put) {
  const at = html.indexOf(find);
  if (at === -1) throw new Error(`[build] snippet not found: ${label}`);
  if (html.indexOf(find, at + 1) !== -1) throw new Error(`[build] snippet is not unique: ${label}`);
  html = html.slice(0, at) + put + html.slice(at + find.length);
}

/* ---------------------------------------------------------------- 1. CSS */

replace('admin css', `    ::selection { background: var(--gold); color: var(--paper); }`,
`    .upload-box input[type=password] {
      font-family: 'EB Garamond', serif;
      font-size: 15px;
      padding: 6px 10px;
      border: 1px solid var(--line);
      background: var(--paper);
      color: var(--ink);
      width: 220px;
      max-width: 100%;
      margin: 8px 6px 0;
    }

    .admin-note {
      font-size: 13.5px;
      margin: 0 0 4px;
    }

    .admin-msg {
      font-size: 12.5px;
      color: var(--seal);
      margin-top: 8px;
      min-height: 1em;
    }

    ::selection { background: var(--gold); color: var(--paper); }`);

/* ------------------------------------------------------------- 2. Markup */

// The uploader only appears once you are signed in.
replace('gate uploader',
`      <div class="panel">
        <h2>Add a Picture</h2>`,
`      <div class="panel" id="uploadPanel" style="display:none;">
        <h2>Add a Picture</h2>`);

// Uploads live on your own server now, so the sandbox warning is repurposed
// into a general "something went wrong" line.
replace('warning copy',
`          <div class="storage-warning" id="uploadWarning">Heads up: this page can't save images in the environment it's currently running in. Uploads will show below but won't be kept after you refresh.</div>`,
`          <div class="storage-warning" id="uploadWarning"></div>`);

replace('upload note',
`          <div class="upload-note">Images are resized before saving to keep things light. Stored privately, so only you see these galleries.</div>`,
`          <div class="upload-note">The original is preserved for full-resolution viewing, with a smaller preview used in the gallery.</div>`);

// Sign-in box in the sidebar, under "Pages".
replace('admin panel',
`      <div class="panel">
        <h2>Pages</h2>
        <ul class="side-nav" id="navList"></ul>
      </div>`,
`      <div class="panel">
        <h2>Pages</h2>
        <ul class="side-nav" id="navList"></ul>
      </div>

      <div class="panel">
        <h2>Ink Keeper</h2>
        <form class="upload-box" id="loginForm">
          <input type="text" id="loginUser" placeholder="username" autocomplete="username"><br>
          <input type="password" id="loginPass" placeholder="password" autocomplete="current-password"><br>
          <button type="submit" id="loginBtn">sign in</button>
          <div class="admin-msg" id="loginMsg"></div>
        </form>
        <div class="upload-box" id="adminWho" style="display:none;">
          <p class="admin-note">Signed in as <strong id="adminName"></strong>.</p>
          <button type="button" id="logoutBtn">sign out</button>
        </div>
      </div>`);

/* --------------------------------------------------- 3. Resize to a Blob */

replace('resize comment',
`  // Resize an uploaded image and return it as a data URL.`,
`  // Resize an uploaded image and hand back a JPEG Blob, ready to POST.`);

replace('resize output',
`        resolve(canvas.toDataURL('image/jpeg', quality));`,
`        canvas.toBlob(
          blob => blob ? resolve(blob) : reject(new Error('could not encode image')),
          'image/jpeg',
          quality
        );`);

/* ------------------------------------------------------ 4. Storage → API */

replace('storage layer',
`  // storageAvailable and the warning banner are shared, since both galleries
  // read and write through the same window.storage API.
  let storageAvailable = true;
  function flagStorageUnavailable() {
    storageAvailable = false;
    document.getElementById('uploadWarning').style.display = 'block';
  }

  async function saveGallery(gallery, state) {
    if (!storageAvailable) return;
    try {
      const result = await window.storage.set(gallery.storageKey, JSON.stringify(state.items), false);
      if (!result) flagStorageUnavailable();
    } catch (e) {
      flagStorageUnavailable();
    }
  }`,
`  // Galleries are readable by anyone; adding and deleting need the admin
  // session cookie, which the browser attaches on its own.
  let isAdmin = false;

  const warningEl = document.getElementById('uploadWarning');

  function showWarning(message) {
    warningEl.textContent = message || '';
    warningEl.style.display = message ? 'block' : 'none';
  }

  async function api(url, options) {
    const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, options));
    let body = null;
    try { body = await res.json(); } catch (e) { /* empty or non-JSON response */ }
    if (!res.ok) throw new Error((body && body.error) || ('request failed (' + res.status + ')'));
    return body;
  }`);

/* ------------------------------------------------------------ 5. Display */

replace('img src',
`      els.img.src = item.dataUrl;`,
`      els.img.src = item.url;`);

replace('full image link',
`      els.full.href = item.dataUrl;`,
`      els.full.href = item.originalUrl || item.url;`);

replace('del visibility',
`      els.del.dataset.id = item.id;`,
`      els.del.dataset.id = item.id;
      els.del.style.display = isAdmin ? '' : 'none'; // only the owner can remove pictures`);

replace('delete handler',
`    els.del.addEventListener('click', async () => {
      state.items = state.items.filter(item => item.id !== els.del.dataset.id);
      await saveGallery(gallery, state);
      render();
    });`,
`    els.del.addEventListener('click', async () => {
      const id = els.del.dataset.id;
      if (!id || !isAdmin) return;

      // The demo placeholder was never on the server, so just clear it locally.
      if (id === 'demo') {
        state.items = [];
        render();
        return;
      }

      if (!confirm('Remove this picture for good?')) return;
      try {
        await api('/api/images/' + encodeURIComponent(id), { method: 'DELETE' });
        state.items = state.items.filter(item => item.id !== id);
        render();
        showWarning('');
      } catch (err) {
        showWarning('Could not remove that picture: ' + err.message);
      }
    });`);

replace('load handler',
`    (async function load() {
      els.loading.style.display = 'block';
      try {
        if (!window.storage) throw new Error('no storage');
        const res = await window.storage.get(gallery.storageKey, false);
        state.items = res && res.value ? JSON.parse(res.value) : [];
      } catch (e) {
        state.items = [];
        flagStorageUnavailable();
      }
      if (state.items.length === 0 && gallery.demoImage) {
        state.items = [{ id: 'demo', dataUrl: gallery.demoImage, caption: gallery.demoCaption, note: gallery.demoNote, date: null }];
      }
      els.loading.style.display = 'none';
      render();
    })();`,
`    async function reload() {
      els.loading.style.display = 'block';
      try {
        const list = await api('/api/galleries/' + encodeURIComponent(k) + '/images');
        // The server sends newest first; render() stores oldest first and flips it.
        state.items = list.reverse();
      } catch (err) {
        state.items = [];
        showWarning('Could not load the galleries: ' + err.message);
      }
      if (state.items.length === 0 && gallery.demoImage) {
        state.items = [{ id: 'demo', url: gallery.demoImage, caption: gallery.demoCaption, note: gallery.demoNote, date: null }];
      }
      els.loading.style.display = 'none';
      render();
    }
    state.reload = reload;
    reload();`);

/* ------------------------------------------------------------- 6. Upload */

replace('upload handler',
`    uploadAdd.disabled = true;
    uploadAdd.textContent = 'saving…';
    try {
      const dataUrl = await resizeImage(uploadFile.files[0], 700, 0.82);
      state.items.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        dataUrl,
        caption: uploadCaption.value.trim(),
        note: uploadNote.value.trim(),
        date: new Date().toISOString()
      });
      state.index = 0; // jump the carousel to the newly added (newest) picture
      await saveGallery(gallery, state);
      state.render();
      uploadFile.value = '';
      uploadCaption.value = '';
      uploadNote.value = '';
    } catch (e) {
      alert('Could not read that image. Try a different file.');
    }
    uploadAdd.disabled = false;
    uploadAdd.textContent = 'add to gallery';`,
`    uploadAdd.disabled = true;
    uploadAdd.textContent = 'saving…';
    showWarning('');
    try {
      // Shrink in the browser so the upload is small and the server can just
      // write the bytes straight to disk.
      const original = uploadFile.files[0];
      const preview = await resizeImage(original, 1400, 0.86);

      const form = new FormData();
      form.append('image', original, original.name);
      form.append('preview', preview, 'preview.jpg');
      form.append('caption', uploadCaption.value.trim());
      form.append('note', uploadNote.value.trim());

      const created = await api('/api/galleries/' + encodeURIComponent(gallery.key) + '/images', {
        method: 'POST',
        body: form
      });

      // Drop the demo placeholder as soon as there's a real picture.
      state.items = state.items.filter(item => item.id !== 'demo');
      state.items.push(created);
      state.index = 0; // jump the carousel to the newly added (newest) picture
      state.render();
      uploadFile.value = '';
      uploadCaption.value = '';
      uploadNote.value = '';
    } catch (err) {
      showWarning('Could not add that picture: ' + err.message);
    }
    uploadAdd.disabled = false;
    uploadAdd.textContent = 'add to gallery';`);

/* --------------------------------------------------------------- 7. Auth */

replace('auth section',
`
</script>`,
`
  /* =========================================================
     6. SIGN IN
     One admin, no signup. The session lives in an httpOnly
     cookie, so nothing sensitive is reachable from here. The
     flags below only decide what is worth showing.
     ========================================================= */

  const loginForm = document.getElementById('loginForm');
  const loginUser = document.getElementById('loginUser');
  const loginPass = document.getElementById('loginPass');
  const loginBtn = document.getElementById('loginBtn');
  const loginMsg = document.getElementById('loginMsg');
  const adminWho = document.getElementById('adminWho');
  const adminName = document.getElementById('adminName');
  const logoutBtn = document.getElementById('logoutBtn');
  const uploadPanel = document.getElementById('uploadPanel');

  function applyAuthState(username) {
    isAdmin = Boolean(username);
    loginForm.style.display = isAdmin ? 'none' : 'block';
    adminWho.style.display = isAdmin ? 'block' : 'none';
    uploadPanel.style.display = isAdmin ? 'block' : 'none';
    adminName.textContent = username || '';
    // Re-render so the delete buttons appear or disappear with the session.
    GALLERIES.forEach(g => galleryState[g.key] && galleryState[g.key].render());
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginMsg.textContent = '';
    loginBtn.disabled = true;
    try {
      const me = await api('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUser.value, password: loginPass.value })
      });
      loginPass.value = '';
      applyAuthState(me.username);
    } catch (err) {
      loginMsg.textContent = err.message;
    }
    loginBtn.disabled = false;
  });

  logoutBtn.addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch (e) { /* signing out anyway */ }
    applyAuthState(null);
  });

  (async function checkSession() {
    try {
      const me = await api('/api/me');
      applyAuthState(me.loggedIn ? me.username : null);
    } catch (e) {
      applyAuthState(null);
    }
  })();

</script>`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`Wrote ${OUT} (${html.length} bytes) from ${path.basename(SRC)}.`);
