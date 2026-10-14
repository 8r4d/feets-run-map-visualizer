<?php
// feets API: user accounts and GPX tracks, stored in MySQL. Called by store.js.
//
// Accounts
//   GET  api.php?action=me             {user, needsSetup}
//   POST api.php?action=setup          {setupPassword, username, password}  first account only, becomes admin
//   POST api.php?action=login          {username, password}
//   POST api.php?action=logout
//   POST api.php?action=signup         {invite, username, password}
//   POST api.php?action=invite         admin only, returns {code}
//
// Tracks (must be logged in; each user only sees their own)
//   GET  api.php                       list tracks
//   GET  api.php?gpx=ID                download the original GPX file
//   POST api.php?action=add            body: track JSON, returns {id}
//   POST api.php?action=update&id=ID   body: {visible, color}
//   POST api.php?action=delete&id=ID

const SESSION_COOKIE = 'feets_session';
const SESSION_DAYS = 30;
const INVITE_DAYS = 7;

const SCHEMA = [
    <<<SQL
    CREATE TABLE IF NOT EXISTS users (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      username      VARCHAR(32)  NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      is_admin      BOOLEAN      NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4
    SQL,
    <<<SQL
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash  CHAR(64) PRIMARY KEY,  -- sha256 of the cookie value
      user_id     INT      NOT NULL,
      expires_at  DATETIME NOT NULL,
      INDEX (user_id)
    ) CHARACTER SET utf8mb4
    SQL,
    <<<SQL
    CREATE TABLE IF NOT EXISTS invites (
      code        CHAR(24)  PRIMARY KEY,
      created_by  INT       NOT NULL,
      created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      used_by     INT       NULL
    ) CHARACTER SET utf8mb4
    SQL,
    <<<SQL
    CREATE TABLE IF NOT EXISTS tracks (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT          NULL,
      name        VARCHAR(255) NOT NULL,
      file_name   VARCHAR(255) NOT NULL,
      color       VARCHAR(16)  NOT NULL,
      visible     BOOLEAN      NOT NULL DEFAULT TRUE,
      distance_m  DOUBLE       NOT NULL DEFAULT 0,
      track_time  VARCHAR(40)  NULL,
      added_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      geometry    LONGTEXT     NOT NULL,
      gpx         LONGTEXT     NOT NULL,
      INDEX (user_id)
    ) CHARACTER SET utf8mb4
    SQL,
];

function send_json($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    echo json_encode($data);
    exit;
}

function fail(string $message, int $status): void {
    send_json(['error' => $message], $status);
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
    fail('feets-config.php not found', 500);
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
        foreach (SCHEMA as $sql) {
            $pdo->exec($sql);
        }
        // Tracks uploaded before accounts existed have no owner column yet.
        if (!$pdo->query("SHOW COLUMNS FROM tracks LIKE 'user_id'")->fetch()) {
            $pdo->exec('ALTER TABLE tracks ADD COLUMN user_id INT NULL AFTER id, ADD INDEX (user_id)');
        }
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

// --- Accounts ---

function is_https(): bool {
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
}

function set_session_cookie(string $value, int $expires): void {
    setcookie(SESSION_COOKIE, $value, [
        'expires' => $expires,
        'path' => '/',
        'secure' => is_https(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

function start_session(int $userId): void {
    $token = bin2hex(random_bytes(32));
    db()->prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, NOW() + INTERVAL ' . SESSION_DAYS . ' DAY)')
        ->execute([hash('sha256', $token), $userId]);
    db()->exec('DELETE FROM sessions WHERE expires_at < NOW()');
    set_session_cookie($token, time() + SESSION_DAYS * 86400);
}

function current_user(): ?array {
    $token = $_COOKIE[SESSION_COOKIE] ?? '';
    if ($token === '') {
        return null;
    }
    $stmt = db()->prepare(
        'SELECT u.id, u.username, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > NOW()'
    );
    $stmt->execute([hash('sha256', $token)]);
    return $stmt->fetch() ?: null;
}

function require_user(): array {
    $user = current_user();
    if (!$user) {
        fail('Not logged in', 401);
    }
    return $user;
}

function user_json(array $user): array {
    return ['username' => $user['username'], 'isAdmin' => (bool) $user['is_admin']];
}

function credentials(array $b): array {
    $username = trim($b['username'] ?? '');
    $password = $b['password'] ?? '';
    if (!preg_match('/^[A-Za-z0-9_.-]{3,32}$/', $username)) {
        fail('Username must be 3-32 letters, numbers, dots, dashes or underscores', 400);
    }
    if (strlen($password) < 8) {
        fail('Password must be at least 8 characters', 400);
    }
    return [$username, $password];
}

function create_user(string $username, string $password, bool $isAdmin): array {
    try {
        db()->prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)')
            ->execute([$username, password_hash($password, PASSWORD_DEFAULT), $isAdmin ? 1 : 0]);
    } catch (PDOException $e) {
        if (($e->errorInfo[1] ?? 0) === 1062) {
            fail('That username is taken', 409);
        }
        throw $e;
    }
    return ['id' => (int) db()->lastInsertId(), 'username' => $username, 'is_admin' => $isAdmin];
}

function needs_setup(): bool {
    return (int) db()->query('SELECT COUNT(*) FROM users')->fetchColumn() === 0;
}

function me(): array {
    $user = current_user();
    return ['user' => $user ? user_json($user) : null, 'needsSetup' => !$user && needs_setup()];
}

// Creates the first (admin) account. Guarded by app_password from feets-config.php,
// and only works while there are no users at all.
function setup(array $b): array {
    global $config;
    if (!needs_setup()) {
        fail('Setup has already been done', 403);
    }
    if (!hash_equals(trim($config['app_password']), trim($b['setupPassword'] ?? ''))) {
        fail('Wrong setup password', 403);
    }
    [$username, $password] = credentials($b);
    $user = create_user($username, $password, true);
    // Tracks uploaded before accounts existed belong to the first account.
    db()->prepare('UPDATE tracks SET user_id = ? WHERE user_id IS NULL')->execute([$user['id']]);
    start_session($user['id']);
    return user_json($user);
}

function login(array $b): array {
    $stmt = db()->prepare('SELECT id, username, is_admin, password_hash FROM users WHERE username = ?');
    $stmt->execute([trim($b['username'] ?? '')]);
    $user = $stmt->fetch();
    if (!$user || !password_verify($b['password'] ?? '', $user['password_hash'])) {
        usleep(random_int(400000, 800000));  // slow down password guessing
        fail('Wrong username or password', 403);
    }
    start_session((int) $user['id']);
    return user_json($user);
}

function logout(): array {
    $token = $_COOKIE[SESSION_COOKIE] ?? '';
    if ($token !== '') {
        db()->prepare('DELETE FROM sessions WHERE token_hash = ?')->execute([hash('sha256', $token)]);
    }
    set_session_cookie('', 1);
    return ['ok' => true];
}

function signup(array $b): array {
    [$username, $password] = credentials($b);
    $pdo = db();
    $pdo->beginTransaction();
    $stmt = $pdo->prepare(
        'SELECT code FROM invites WHERE code = ? AND used_by IS NULL
         AND created_at > NOW() - INTERVAL ' . INVITE_DAYS . ' DAY FOR UPDATE'
    );
    $stmt->execute([$b['invite'] ?? '']);
    if (!$stmt->fetch()) {
        $pdo->rollBack();
        fail('This invite link is invalid, already used, or expired', 403);
    }
    $user = create_user($username, $password, false);
    $pdo->prepare('UPDATE invites SET used_by = ? WHERE code = ?')->execute([$user['id'], $b['invite']]);
    $pdo->commit();
    start_session($user['id']);
    return user_json($user);
}

function create_invite(array $user): array {
    if (!$user['is_admin']) {
        fail('Only the admin can invite people', 403);
    }
    $code = bin2hex(random_bytes(12));
    db()->prepare('INSERT INTO invites (code, created_by) VALUES (?, ?)')->execute([$code, $user['id']]);
    return ['code' => $code];
}

// --- Tracks ---

function list_tracks(int $userId): array {
    $stmt = db()->prepare(
        'SELECT id, name, file_name, color, visible, distance_m, track_time, geometry
         FROM tracks WHERE user_id = ? ORDER BY id'
    );
    $stmt->execute([$userId]);
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
    }, $stmt->fetchAll());
}

function add_track(int $userId, array $t): array {
    $stmt = db()->prepare(
        'INSERT INTO tracks (user_id, name, file_name, color, visible, distance_m, track_time, geometry, gpx)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $userId,
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

function update_track(int $userId, int $id, array $t): array {
    db()->prepare('UPDATE tracks SET visible = ?, color = ? WHERE id = ? AND user_id = ?')
        ->execute([$t['visible'] ? 1 : 0, $t['color'], $id, $userId]);
    return ['ok' => true];
}

function delete_track(int $userId, int $id): array {
    db()->prepare('DELETE FROM tracks WHERE id = ? AND user_id = ?')->execute([$id, $userId]);
    return ['ok' => true];
}

function download_gpx(int $userId, int $id): void {
    $stmt = db()->prepare('SELECT file_name, gpx FROM tracks WHERE id = ? AND user_id = ?');
    $stmt->execute([$id, $userId]);
    $row = $stmt->fetch();
    if (!$row) {
        fail('Track not found', 404);
    }
    $fileName = preg_replace('/["\\\\\r\n]/', '_', $row['file_name']);
    header('Content-Type: application/gpx+xml');
    header('Content-Disposition: attachment; filename="' . $fileName . '"');
    echo $row['gpx'];
    exit;
}

// --- Routing ---

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$id = (int) ($_GET['id'] ?? 0);

if ($method === 'GET' && $action === 'me') {
    send_json(me());
} elseif ($method === 'POST' && $action === 'setup') {
    send_json(setup(read_json()));
} elseif ($method === 'POST' && $action === 'login') {
    send_json(login(read_json()));
} elseif ($method === 'POST' && $action === 'logout') {
    send_json(logout());
} elseif ($method === 'POST' && $action === 'signup') {
    send_json(signup(read_json()));
}

$user = require_user();
$userId = (int) $user['id'];

if ($method === 'POST' && $action === 'invite') {
    send_json(create_invite($user));
} elseif ($method === 'GET' && isset($_GET['gpx'])) {
    download_gpx($userId, (int) $_GET['gpx']);
} elseif ($method === 'GET') {
    send_json(list_tracks($userId));
} elseif ($method === 'POST' && $action === 'add') {
    send_json(add_track($userId, read_json()));
} elseif ($method === 'POST' && $action === 'update' && $id) {
    send_json(update_track($userId, $id, read_json()));
} elseif ($method === 'POST' && $action === 'delete' && $id) {
    send_json(delete_track($userId, $id));
} else {
    fail('Unknown request', 404);
}
