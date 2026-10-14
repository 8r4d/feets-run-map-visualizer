# feets

A small personal web app for viewing GPX tracks on an OpenStreetMap map.
Tracks are stored in MySQL through a single PHP file, `api.php`.

## Deploy to your web host

1. Upload `feets-config.php` **one folder above** your website's public folder,
   if your host lets you. If it doesn't, put it inside the public folder next to
   `api.php`. That's still safe: the web server runs `.php` files instead of
   sending their contents.
2. Upload everything in `public/` into your website folder, or into a subfolder
   such as `feets/`. Every URL is relative, so a subfolder works fine.
3. Open the site and enter the `app_password` from `feets-config.php` when
   asked. The browser remembers it.

The `tracks` table is created automatically on the first request.

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
| `feets-config.php`   | Database credentials and the app password. Ignored by git. |
| `public/api.php`     | Reads and writes tracks in MySQL. It's the only backend code. |
| `public/index.html`  | Page layout. Loads Leaflet from a CDN.                   |
| `public/app.js`      | Map setup, track list UI, file upload handling.          |
| `public/gpx.js`      | Parses GPX tracks, routes and waypoints in the browser, and works out distance. |
| `public/store.js`    | Calls `api.php`, and asks for the app password when needed. |
| `public/style.css`   | Styles.                                                  |

## Notes

- **App password.** Every API request has to include the app password. Without it,
  nobody can see or change your tracks. The page itself, with an empty map, is
  still public.
- **Use HTTPS.** Open the site over `https://` so the password is encrypted on its
  way to the server.
- **Large files.** Uploads larger than PHP's `post_max_size` (often 8 MB on shared
  hosting) or MySQL's `max_allowed_packet` will fail.
