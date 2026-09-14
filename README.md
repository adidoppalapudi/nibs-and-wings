# Nib & Wings

A single-author calligraphy practice log. Express, two JSON files, no database.

Anyone can read the galleries. One admin account, you, can add and delete
pictures. There is no signup, because there is nobody else to sign up.

Wanna expand it for multiple users eventually when I get time.
---

## What's here

| File or folder | Purpose |
|---|---|
| `nib-and-wings.html` | Source file for the design, copy, and gallery configuration |
| `build-public.js` | Generates `public/index.html` |
| `public/index.html` | Generated website file; do not edit manually |
| `server.js` | Express backend |
| `seed-admin.js` | Creates the admin account from `.env` credentials |
| `smoke-test.js` | End-to-end tests for the running server |
| `lib/store.js` | Handles JSON reading and writing |
| `data/admin.json` | Admin username and password hash; generated and ignored |
| `data/images.json` | Stored image metadata; generated and ignored |
| `uploads/` | Uploaded image files; generated and ignored |
| `deploy/` | systemd service and nginx configuration |

---

## Running it locally

```bash
npm install

cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# paste that into SESSION_SECRET, and pick an ADMIN_USERNAME / ADMIN_PASSWORD

npm run seed      # writes data/admin.json
npm start         # http://127.0.0.1:3000
```

Sign in through the **Ink Keeper** box in the right sidebar. The uploader and
the little `×` delete buttons only appear once you're signed in.

To change your password later, edit `ADMIN_PASSWORD` in `.env`, run
`npm run seed` again, then restart. It's safe to re-run any time.

To confirm everything works end to end, with the server running:

```bash
node smoke-test.js
```

That exercises all six routes, checks the cookie flags, uploads a file named
`../../evil.jpg` to prove it can't escape `uploads/`, and cleans up after
itself.

---

## The HTML

Your `nib-and-wings.html` was written for a sandbox that provided a
`window.storage` key-value API, and it kept images as base64 data URLs. It had
no `/api/...` calls in it, and no login form.

`build-public.js` copies it to `public/index.html` and swaps only the data
layer. The build never writes back to `nib-and-wings.html`. That file is yours
to edit by hand.

| Was | Now |
|---|---|
| `window.storage.get/set` | `fetch('/api/galleries/:key/images')` |
| base64 data URL per image | optimized preview plus a click-to-open original in `uploads/` |
| `canvas.toDataURL(...)` | `canvas.toBlob(...)` then `FormData` |
| delete removes from local array | `DELETE /api/images/:id` |
| nothing | sign-in box, and auth gating on the uploader and delete buttons |
| nothing | per-picture note field, shown under the caption |

The build leaves the design alone. The pixel bird, the CSS, the copy, the
carousel, the word of the day and the ASCII placeholder images all pass through
verbatim.

**Edit `nib-and-wings.html`, never `public/index.html`.** `npm start` runs the
build first, so a restart picks up your edits. Each replacement is asserted, so
if you rewrite one of the swapped blocks the build fails with the name of the
snippet it could no longer find, rather than quietly shipping a broken page.

---

## The API

| Route | Auth | Notes |
|---|---|---|
| `POST /api/login` | no | `{username, password}`, sets the session cookie |
| `POST /api/logout` | no | |
| `GET /api/me` | no | `{loggedIn, username}` |
| `GET /api/galleries/:key/images` | no | `[{id, url, originalUrl, caption, note, date}]`, newest first |
| `POST /api/galleries/:key/images` | yes | multipart: `image` (original), optional `preview`, `caption`, `note` |
| `DELETE /api/images/:id` | yes | removes the record *and* the file |

Two galleries ship configured. `flourish` holds your own work, `inspiration`
holds flourishes by other hands. Each picture carries a short `caption` and a
longer `note`, the sentence about what inspired the piece or where you found
it. The note renders under the caption in the carousel. It's optional, and an
empty one collapses to nothing.

Adding or renaming a gallery needs no backend change. Edit the `GALLERIES`
array in `nib-and-wings.html` and rebuild. `gallery_key` is just a string
column, so a renamed key starts empty. Pictures filed under the old key stay in
`images.json` but stop appearing. To carry them over, search and replace the old
`gallery_key` value in `data/images.json`, then restart.

A few things the server does that aren't obvious from the route list:

- It renames every upload to `<timestamp>-<random>.<ext>`. The client's
  filename never decides where bytes land.
- It accepts only `image/jpeg`, `image/png`, `image/webp` and `image/gif`,
  with a 25 MB per-file limit. The browser uploads the untouched original plus
  a smaller JPEG preview for the carousel.
- It throttles login to 10 attempts per IP per 15 minutes, and runs a bcrypt
  compare even for a wrong username, so that isn't measurably faster than a
  wrong password.
- `writeJSON` writes to a temp file and renames it into place, so a crash
  mid-write can't leave you with a truncated `images.json`.
- Express listens on `127.0.0.1` only. nginx is the thing facing the internet.

---

## Deploying to a Google Cloud Ubuntu VM

Assumes a Google Compute Engine instance running Ubuntu 22.04/24.04, and a
domain pointed at the instance's external IP.

### 1. Open the ports

Create a Google Cloud VPC firewall rule allowing TCP ports `80` and `443` to
the VM. Also allow the same ports through any local firewall configured on the
VM.

For a standard Ubuntu VM, the local rules are:

**On the VM:**

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

### 2. Install Node and nginx

```bash
sudo apt update && sudo apt install -y nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v    # expect v22.x
```

Node 22 is the current LTS, and anything 18 or newer works. Nothing here
compiles, since `bcryptjs` is pure JavaScript on purpose.

### 3. Create the service user and lay down the app

```bash
sudo useradd --system --home /srv/nib-and-wings --shell /usr/sbin/nologin nibwings
sudo mkdir -p /srv/nib-and-wings
sudo chown nibwings:nibwings /srv/nib-and-wings

# copy the project up from your machine, e.g.
#   rsync -av --exclude node_modules --exclude .env --exclude data --exclude uploads \
#     ./ ubuntu@YOUR_IP:/tmp/nib-and-wings/
sudo cp -r /tmp/nib-and-wings/. /srv/nib-and-wings/
cd /srv/nib-and-wings

sudo -u nibwings npm ci --omit=dev
sudo -u nibwings mkdir -p data uploads
```

### 4. Configure and seed

```bash
sudo -u nibwings cp .env.example .env
sudo -u nibwings nano .env
#   PORT=3000
#   NODE_ENV=production
#   SESSION_SECRET=<32 random bytes, hex>
#   ADMIN_USERNAME=<you>
#   ADMIN_PASSWORD=<a good one>

sudo chmod 600 .env                      # it holds your session secret
sudo -u nibwings npm run seed
sudo -u nibwings npm run build           # generates public/index.html
```

You can blank `ADMIN_PASSWORD` afterwards. The server only ever reads the hash
out of `data/admin.json`.

### 5. systemd

```bash
sudo cp deploy/nib-and-wings.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nib-and-wings
sudo systemctl status nib-and-wings
curl -s localhost:3000/api/me            # {"loggedIn":false,"username":null}
```

### 6. nginx

`deploy/nginx.conf` serves `/uploads/` straight off disk and proxies everything
else to Node. nginx runs as `www-data`, so it needs to be able to traverse into
the app directory:

```bash
sudo chmod o+x /srv/nib-and-wings
sudo chmod o+rx /srv/nib-and-wings/uploads
```

Then:

```bash
sudo sed -i 's/YOUR_DOMAIN/nibandwings.example.com/g' deploy/nginx.conf
sudo cp deploy/nginx.conf /etc/nginx/sites-available/nib-and-wings
sudo ln -s /etc/nginx/sites-available/nib-and-wings /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

The file ships with the TLS block already written, which `nginx -t` rejects
until the certificates exist. Either comment out the `443` block for the first
`nginx -t`, or go straight to step 7. certbot creates the certs and then the
config validates.

### 7. HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d nibandwings.example.com -d www.nibandwings.example.com
```

`NODE_ENV=production` sets `secure: true` on the session cookie, so **sign-in
will not work over plain HTTP in production.** Finish this step before trying
to log in. certbot's own systemd timer renews the certificate.

### 8. Backups

Everything that matters is three paths. A nightly copy is enough:

```bash
sudo crontab -e
# 0 3 * * * tar czf /root/nw-$(date +\%F).tgz -C /srv/nib-and-wings data uploads .env && find /root -name 'nw-*.tgz' -mtime +14 -delete
```

Google Cloud persistent disks do not automatically back up the VM. Keep these
backups outside the application directory or use scheduled disk snapshots.

### Updating later

```bash
cd /srv/nib-and-wings
# copy in the new files, then:
sudo -u nibwings npm ci --omit=dev
sudo -u nibwings npm run build
sudo systemctl restart nib-and-wings
```

Express keeps sessions in memory, so a restart signs you out. Log back in.
Nothing else is lost.

---

## Troubleshooting

**Site unreachable, but `curl localhost:3000` works from the VM.** Check the
Google Cloud VPC firewall rule, the VM's network tag/target settings, and the
local firewall rules. All are covered by step 1.

**"No admin configured. Run `npm run seed`."** `data/admin.json` is missing, or
`nibwings` can't read it. Check with
`sudo -u nibwings cat /srv/nib-and-wings/data/admin.json`.

**Sign-in appears to succeed but you're immediately signed out again.** The
cookie is `secure` in production and the browser dropped it because you're on
HTTP. Finish step 7.

**Login works but uploads 401.** Same cause, or nginx isn't passing
`X-Forwarded-Proto`. The supplied config sets it.

**Uploads 413.** nginx's `client_max_body_size`. The config sets 30 MB.

**Images 404 while the page loads fine.** nginx is serving `/uploads/` itself
and can't traverse into the directory. Run the two `chmod` commands in step 6.

For anything else, `journalctl -u nib-and-wings -n 50` is the first place to
look.
