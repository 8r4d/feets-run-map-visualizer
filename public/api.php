<?php
// feets API: stores tracks in MySQL. Called by store.js.
//
//   GET  api.php                      list tracks
//   GET  api.php?gpx=ID               download the original GPX file
//   POST api.php?action=add           body: track JSON, returns {id}
//   POST api.php?action=update&id=ID  body: {visible, color}
//   POST api.php?action=delete&id=ID
//
// Every request must send the app password in the feets_password cookie (set by store.js).

const SCHEMA = <<<SQL
CREATE TABLE IF NOT EXISTS tracks (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  file_name   VARCHAR(255) NOT NULL,
  color       VARCHAR(16)  NOT NULL,
  visible     BOOLEAN      NOT NULL DEFAULT TRUE,
  distance_m  DOUBLE       NOT NULL DEFAULT 0,
  track_time  VARCHAR(40)  NULL,
  added_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  geometry    LONGTEXT     NOT NULL,
  gpx         LONGTEXT     NOT NULL
) CHARACTER SET utf8mb4
SQL;

function send_json($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    echo json_encode($data);
    exit;
}

set_exception_handler(function (Throwable $err) {
    error_log('feets API error: ' . $err->getMessage());
    send_json(['error' => $err->getMessage()], 500);
});

// Look for the config file one folder above the web root first (not reachable
// from the web at all), then next to this file.
$config = null;
foreach ([dirname(__DIR__) . '/feets-config.php', __DIR__ . '/feets-config.php'] as $path) {
    if (is_file($path)) {
        $config = require $path;
        break;
    }
}
if (!$config) {
    send_json(['error' => 'feets-config.php not found'], 500);
}

$given = trim($_COOKIE['feets_password'] ?? '');
if ($given === '') {
    send_json(['error' => 'No password received'], 401);
}
if (!hash_equals(trim($config['app_password']), $given)) {
    send_json(['error' => 'Wrong password'], 401);
}

function db(): PDO {
    global $config;
    static $pdo = null;
    if (!$pdo) {
        $c = $config['mysql'];
        $pdo = new PDO(
            "mysql:host={$c['host']};port={$c['port']};dbname={$c['database']};charset=utf8mb4",
            $c['user'],
            $c['password'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
        );
        $pdo->exec(SCHEMA);
    }
    return $pdo;
}

function read_json(): array {
    $data = json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) {
        throw new RuntimeException('Request body is not valid JSON');
    }
    return $data;
}

function list_tracks(): array {
    $rows = db()->query(
        'SELECT id, name, file_name, color, visible, distance_m, track_time, geometry FROM tracks ORDER BY id'
    )->fetchAll();
    return array_map(function ($row) {
        $geometry = json_decode($row['geometry'], true);
        return [
            'id' => (int) $row['id'],
            'name' => $row['name'],
            'fileName' => $row['file_name'],
            'color' => $row['color'],
            'visible' => (bool) $row['visible'],
            'distance' => (float) $row['distance_m'],
            'time' => $row['track_time'],
            'segments' => $geometry['segments'],
            'waypoints' => $geometry['waypoints'],
        ];
    }, $rows);
}

function add_track(array $t): array {
    $stmt = db()->prepare(
        'INSERT INTO tracks (name, file_name, color, visible, distance_m, track_time, geometry, gpx)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        mb_substr($t['name'], 0, 255),
        mb_substr($t['fileName'], 0, 255),
        $t['color'],
        $t['visible'] ? 1 : 0,
        (float) $t['distance'],
        $t['time'] ?? null,
        json_encode(['segments' => $t['segments'], 'waypoints' => $t['waypoints']]),
        $t['gpx'],
    ]);
    return ['id' => (int) db()->lastInsertId()];
}

function update_track(int $id, array $t): array {
    db()->prepare('UPDATE tracks SET visible = ?, color = ? WHERE id = ?')
        ->execute([$t['visible'] ? 1 : 0, $t['color'], $id]);
    return ['ok' => true];
}

function delete_track(int $id): array {
    db()->prepare('DELETE FROM tracks WHERE id = ?')->execute([$id]);
    return ['ok' => true];
}

function download_gpx(int $id): void {
    $stmt = db()->prepare('SELECT file_name, gpx FROM tracks WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) {
        send_json(['error' => 'Track not found'], 404);
    }
    $fileName = preg_replace('/["\\\\\r\n]/', '_', $row['file_name']);
    header('Content-Type: application/gpx+xml');
    header('Content-Disposition: attachment; filename="' . $fileName . '"');
    echo $row['gpx'];
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$id = (int) ($_GET['id'] ?? 0);

if ($method === 'GET' && isset($_GET['gpx'])) {
    download_gpx((int) $_GET['gpx']);
} elseif ($method === 'GET') {
    send_json(list_tracks());
} elseif ($method === 'POST' && $action === 'add') {
    send_json(add_track(read_json()));
} elseif ($method === 'POST' && $action === 'update' && $id) {
    send_json(update_track($id, read_json()));
} elseif ($method === 'POST' && $action === 'delete' && $id) {
    send_json(delete_track($id));
} else {
    send_json(['error' => 'Unknown request'], 404);
}
