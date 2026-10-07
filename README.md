# fmat-log-viewer

A fully static, password-protected viewer for a personal SQLite activity log.

The browser downloads an **encrypted** SQLite database, decrypts it entirely
client-side (WebCrypto), and queries it in-memory with
[sql.js](https://sql.js.org/) — no server, no backend, no external requests.

## Features

- **Unlock screen** — data is stored encrypted (AES-256-GCM); it can only be
  read after the correct password is entered.
- **Search bar** — literal, case-insensitive substring match over the log
  entries (no wildcard interpretation).
- **Filters** — entry type, status, month, follow-up; sortable; the current
  view is reflected in the URL hash, so views are bookmarkable.
- **Entries** — card list with expand/collapse, ETA, cross-references between
  entries, incremental "load more" pagination.
- **Reports** — generated markdown reports rendered in the browser.
- **Stats** — entry counts by type/status and last-update timestamp.

## Repository layout

```
index.html          entry point (password screen + app)
css/                styles
js/crypto.js        password → key derivation → decryption
js/app.js           sql.js setup, search/filter/render logic
vendor/             sql.js and marked (self-hosted, no CDN)
scripts/encrypt.py  database → encrypted blob
scripts/publish.ps1 one-command daily publish
data/log.enc        the encrypted database (the only data file in the repo)
```

The plaintext database (`*.db`) is **gitignored** and is never committed.

## Daily publish

```powershell
.\scripts\publish.ps1
```

The script asks for the password, encrypts the local database into
`data/log.enc`, then commits and pushes. GitHub Pages republishes
automatically within a few minutes.

## Change password

The password is never stored anywhere — it is only used to encrypt/decrypt.
To change it:

1. Run the encryptor directly and enter the **new** password:

   ```powershell
   python scripts\encrypt.py personal_log.db data\log.enc
   ```

2. Commit and push:

   ```powershell
   git add data/log.enc
   git commit -m "Rotate encryption password"
   git push
   ```

3. Update the password wherever you keep it. Old published pages holding the
   blob in cache will fail to unlock until they reload — that is expected.

Anyone who loses the password loses access to the copy hosted here (the local
plaintext database is unaffected).

## Local testing

Static pages cannot `fetch` files over `file://`, so serve the folder locally:

```powershell
python -m http.server 8080
# open http://localhost:8080
```

## Security notes

- The committed database blob is encrypted with AES-256-GCM; the key is
  derived from the password with PBKDF2-HMAC-SHA256 (200 000 iterations,
  random 16-byte salt per publish).
- Decryption happens in memory only; nothing is persisted in the browser.
- Password strength is the real security boundary: use a long, unique
  password if the data matters.
- The site ships no third-party scripts; all assets are self-hosted.

## License

[MIT](LICENSE)
