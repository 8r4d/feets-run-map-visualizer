#!/usr/bin/env python3
"""feets server: serves the app from public/ and stores tracks in MySQL."""
import configparser
import json
import re
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pymysql

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.ini"
CONFIG = configparser.ConfigParser()

SCHEMA = """
CREATE TABLE IF NOT EXISTS tracks (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  file_name   VARCHAR(255) NOT NULL,
  color       VARCHAR(16)  NOT NULL,
  visible     BOOLEAN      NOT NULL DEFAULT TRUE,
  distance_m  DOUBLE       NOT NULL DEFAULT 0,
  track_time  VARCHAR(40)  NULL,
  added_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  geometry    LONGTEXT     NOT NULL,  -- JSON: {segments, waypoints} as parsed by the browser
  gpx         LONGTEXT     NOT NULL   -- the original uploaded file
) CHARACTER SET utf8mb4
"""

TRACK_PATH = re.compile(r"/api/tracks/(\d+)")
GPX_PATH = re.compile(r"/api/tracks/(\d+)/gpx")


# --- Database ---

def connect():
    db = CONFIG["mysql"]
    kwargs = dict(
        host=db["host"],
        port=db.getint("port", fallback=3306),
        user=db["user"],
        password=db["password"],
        database=db["database"],
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
        connect_timeout=10,
    )
    if db.getboolean("ssl", fallback=False):
        kwargs.update(ssl_verify_cert=True, ssl_verify_identity=True)
        if db.get("ssl_ca"):
            kwargs["ssl_ca"] = db["ssl_ca"]
    return pymysql.connect(**kwargs)


def query(sql, args=()):
    """Run one statement on a fresh connection. Returns (rows, lastrowid)."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, args)
        return cur.fetchall(), cur.lastrowid


def list_tracks():
    rows, _ = query(
        "SELECT id, name, file_name, color, visible, distance_m, track_time, geometry"
        " FROM tracks ORDER BY id"
    )
    tracks = []
    for row in rows:
        geometry = json.loads(row["geometry"])
        tracks.append({
            "id": row["id"],
            "name": row["name"],
            "fileName": row["file_name"],
            "color": row["color"],
            "visible": bool(row["visible"]),
            "distance": row["distance_m"],
            "time": row["track_time"],
            "segments": geometry["segments"],
            "waypoints": geometry["waypoints"],
        })
    return tracks


def add_track(t):
    _, new_id = query(
        "INSERT INTO tracks"
        " (name, file_name, color, visible, distance_m, track_time, geometry, gpx)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (
            t["name"][:255],
            t["fileName"][:255],
            t["color"],
            bool(t["visible"]),
            float(t["distance"]),
            t.get("time"),
            json.dumps({"segments": t["segments"], "waypoints": t["waypoints"]}),
            t["gpx"],
        ),
    )
    return {"id": new_id}


def update_track(track_id, t):
    query("UPDATE tracks SET visible = %s, color = %s WHERE id = %s",
          (bool(t["visible"]), t["color"], track_id))
    return {"ok": True}


def delete_track(track_id):
    query("DELETE FROM tracks WHERE id = %s", (track_id,))
    return {"ok": True}


# --- HTTP ---

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "public"), **kwargs)

    def do_GET(self):
        if self.path == "/api/tracks":
            return self.api(list_tracks)
        m = GPX_PATH.fullmatch(self.path)
        if m:
            return self.download_gpx(int(m[1]))
        if self.path.startswith("/api/"):
            return self.send_error(HTTPStatus.NOT_FOUND)
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/tracks":
            return self.api(lambda: add_track(self.read_json()))
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_PATCH(self):
        m = TRACK_PATH.fullmatch(self.path)
        if m:
            return self.api(lambda: update_track(int(m[1]), self.read_json()))
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_DELETE(self):
        m = TRACK_PATH.fullmatch(self.path)
        if m:
            return self.api(lambda: delete_track(int(m[1])))
        self.send_error(HTTPStatus.NOT_FOUND)

    def api(self, fn):
        try:
            result = fn()
        except Exception as err:
            self.log_error("API error: %r", err)
            return self.send_json({"error": str(err)}, HTTPStatus.INTERNAL_SERVER_ERROR)
        self.send_json(result)

    def read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length))

    def send_json(self, data, status=HTTPStatus.OK):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def download_gpx(self, track_id):
        rows, _ = query("SELECT file_name, gpx FROM tracks WHERE id = %s", (track_id,))
        if not rows:
            return self.send_error(HTTPStatus.NOT_FOUND)
        body = rows[0]["gpx"].encode()
        file_name = re.sub(r'["\\\r\n]', "_", rows[0]["file_name"])
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/gpx+xml")
        self.send_header("Content-Disposition", f'attachment; filename="{file_name}"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    if not CONFIG.read(CONFIG_PATH):
        sys.exit(f"Missing {CONFIG_PATH.name}. Fill in your MySQL details there and try again.")
    try:
        query(SCHEMA)
    except pymysql.MySQLError as err:
        sys.exit(f"Could not connect to MySQL: {err}")

    host = CONFIG.get("server", "host", fallback="127.0.0.1")
    port = CONFIG.getint("server", "port", fallback=8000)
    print(f"feets running at http://{host}:{port}  (Ctrl+C to stop)")
    try:
        ThreadingHTTPServer((host, port), Handler).serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
