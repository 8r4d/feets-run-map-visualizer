# feets

A small personal web app for viewing GPX tracks on an OpenStreetMap map.
Tracks are stored in MySQL through a single PHP file, `api.php`. Each person
logs in with their own account and sees only their own tracks. New accounts are
created by invitation.

## Deploy to your web host

1. Upload `feets-config.php` **one folder above** your website's public folder,
   if your host lets you. If it doesn't, put it inside the public folder next to
   `api.php`. That's still safe: the web server runs `.php` files instead of
   sending their contents.
2. Upload everything in `public/` into your website folder, or into a subfolder
   such as `feets/`. Every URL is relative, so a subfolder works fine.
3. Open the site. On the very first visit it asks for the `app_password` from
   `feets-config.php`. Enter it, then choose your own username and password.
   That account becomes the admin, and any tracks already in the database are
   assigned to it.

The database tables are created automatically on the first request.

## Inviting people

Click **Invite** (only the admin sees it) to get a link. Each link works once,
within 7 days. The person opens it, chooses a username and password, and gets
their own empty track list.

When you change any JS or CSS file, raise the `?v=` number on its link in
`index.html`. Otherwise the host may keep serving the old file.

## Run locally

```sh
cd ~/Code/feets/public
php -S localhost:8000
```

Open http://localhost:8000. The database has to accept connections from your
computer for this to work. Many shared hosts only allow connections from their
own web servers.

## Use

- Drag `.gpx` files anywhere onto the page, or click the drop zone to pick them.
- In the track list:
  - tick or untick a track to show or hide it
  - click its name to zoom to it
  - click ↓ to download the original GPX file
  - click × to delete it
- Use the layer control in the top right to switch between the OpenStreetMap and OpenTopoMap base maps.

## Files

| File                 | Purpose                                                  |
|----------------------|----------------------------------------------------------|
| `feets-config.php`   | Database credentials and the one-time setup password. Ignored by git. |
| `public/api.php`     | Accounts, logins, invites and tracks, all in MySQL. It's the only backend code. |
| `public/index.html`  | Page layout. Loads Leaflet from a CDN.                   |
| `public/app.js`      | Map setup, track list UI, file upload handling, login form. |
| `public/gpx.js`      | Parses GPX tracks, routes and waypoints in the browser, and works out distance. |
| `public/store.js`    | Calls `api.php`.                                         |
| `public/style.css`   | Styles.                                                  |

## Notes

- **Logins.**
  - Passwords are stored as hashes made with PHP's `password_hash`.
  - A login lasts 30 days. It's kept in the `sessions` table, and the browser holds
    it in an HttpOnly cookie the page's JavaScript can't read.
  - A wrong password costs about half a second, which slows down guessing. There's
    no lockout, so use real passwords.
- **Use HTTPS.** Open the site over `https://` so passwords are encrypted on their
  way to the server.
- **Large files.** Uploads larger than PHP's `post_max_size` (often 8 MB on shared
  hosting) or MySQL's `max_allowed_packet` will fail.
