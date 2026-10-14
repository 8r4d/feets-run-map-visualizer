# feets

A small personal web app for viewing GPX tracks on an OpenStreetMap map.
Tracks are stored in MySQL (or MariaDB). A single Python file serves the
page and talks to the database.

## Setup (once)

1. Create an empty database on your MySQL server, plus a user that can create
   tables in it. feets creates its own `tracks` table on first run.
2. Fill in `config.ini` with the host, user, password and database name.
   Hosted MySQL usually needs `ssl = true`.
3. Install the one dependency:
   ```sh
   cd ~/Code/feets
   python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   ```

## Run

```sh
cd ~/Code/feets
.venv/bin/python server.py
```

Open http://localhost:8000.

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
| `server.py`          | Serves `public/` and stores tracks in MySQL. It's the only backend code. |
| `config.ini`         | Database credentials and server settings. Ignored by git. |
| `public/index.html`  | Page layout. Loads Leaflet from a CDN.                   |
| `public/app.js`      | Map setup, track list UI, file upload handling.          |
| `public/gpx.js`      | Parses GPX tracks, routes and waypoints in the browser, and works out distance. |
| `public/store.js`    | Talks to the server's `/api/tracks` endpoints.           |
| `public/style.css`   | Styles.                                                  |

Only `public/` is served to the browser, so `config.ini` and `server.py` can't
be downloaded from the app.

## Database

There's one table, `tracks`. Each row holds:
- the original GPX file (`gpx`)
- the parsed points the map draws (`geometry`, stored as JSON text)
- the name, colour, visible flag, distance and date

## Notes

- **No login.** Anyone who can reach the page can add or delete tracks. That's
  why it listens on `127.0.0.1` (this computer only) by default.
- **Large files.** A GPX file bigger than the MySQL server's `max_allowed_packet`
  setting will fail to upload. The default is 64 MB on MySQL 8, but some hosts set
  it lower.
