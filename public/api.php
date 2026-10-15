<?php
// feets API: user accounts and GPX tracks, stored in MySQL. Called by store.js.
//
// Accounts
//   GET  api.php?action=me             {user, needsSetup}
//   POST api.php?action=setup          {setupPassword, username, password}  first account only, becomes admin
//   POST api.php?action=login          {username, password}
//   POST api.php?action=logout
//   POST api.php?action=signup         {invite, username, password}
//   POST api.php?action=invite         admin only: {viewer}, returns {code}. Viewers get a view-only account
//                                      that sees the admin's tracks and areas and can't change anything.
//   POST api.php?action=change_password  {current, password}
//   POST api.php?action=reset_link     admin only: {username}, returns {code, username}
//   GET  api.php?action=reset_info&code=CODE  {username} for a reset link
//   POST api.php?action=reset_password {code, password}
//   POST api.php?action=recover        {setupPassword, username, password}  locked-out admin
//   GET  api.php?action=view_links     the user's view links: [{code, label, createdAt}]
//   POST api.php?action=view_link_create  {label}, returns {code}
//   POST api.php?action=view_link_delete  {code}
//
// View links: any request with ?view=CODE is answered as a view-only account
// of the link's owner that can only list saved routes, with no login, until
// the owner turns the link off.
//
// Tracks (must be logged in; each user only sees their own)
//   GET  api.php                       list tracks
//   GET  api.php?gpx=ID                download the original GPX file
//   POST api.php?action=add            body: track JSON, returns {id}
//   POST api.php?action=update&id=ID   body: {visible, color}
//   POST api.php?action=set_visible    body: {ids, visible}  show or hide many tracks at once
//   POST api.php?action=delete&id=ID
//
// Routes are stored simplified (to ~3 m) for drawing; the original GPX is kept for download.
//
// Strava (each user connects their own account)
//   GET  api.php?action=strava_status      {configured, connected, athlete}
//   GET  api.php?action=strava_connect     page navigation: redirects to Strava's approval screen
//   GET  api.php?action=strava_callback    Strava redirects back here, then on to the app
//   POST api.php?action=strava_sync        imports the next batch, returns {tracks, done, rateLimited}
//   POST api.php?action=strava_disconnect
//   POST api.php?action=strava_auto_on     admin only: subscribe to Strava's webhook
//   POST api.php?action=strava_auto_off    admin only
//   strava-webhook.php                     Strava's webhook calls land here (see strava_webhook)
//
// Street coverage areas (each user picks their own)
//   GET  api.php?action=areas                all of the user's areas, with streets
//   POST api.php?action=area_save            {osmId, name, data} prepared by osm.js; replaces an existing one
//   POST api.php?action=area_delete&id=ID
//   POST api.php?action=area_exclude&id=ID   {ways, excluded}: mark OSM ways unrunnable (or count them again)
//
// Planned routes (drawn in the browser by planner.js)
//   GET  api.php?action=routes               all of the user's routes, newest first
//   POST api.php?action=route_save           {id?, name, distance, data}; with id, replaces that route. Returns it
//   POST api.php?action=route_rename&id=ID   {name}, returns the route
//   POST api.php?action=route_delete&id=ID
//
// Achievements (worked out in the browser by achievements.js; the server only remembers them)
//   GET  api.php?action=achievements         [{code, title, detail, earnedAt}], oldest first
//   POST api.php?action=achievement_add      {achievements: [{code, title, detail}]}; already-earned codes are ignored

const SESSION_COOKIE = 'feets_session';
const SESSION_DAYS = 30;
const INVITE_DAYS = 7;
const RESET_HOURS = 48;

// Columns every user lookup returns (users table aliased as u).
const USER_COLUMNS = 'u.id, u.username, u.is_admin, u.read_only, u.data_owner';

const STRAVA_STATE_COOKIE = 'feets_strava_state';
const STRAVA_BATCH = 10;          // activities imported per strava_sync request
const STRAVA_TIME_BUDGET = 20;    // seconds; stay under shared hosting's execution limit

// Same palette as app.js, used for tracks imported on the server.
const TRACK_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#9a6324', '#000075', '#808000'];

const SCHEMA = [
    <<<SQL
    CREATE TABLE IF NOT EXISTS users (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      username      VARCHAR(32)  NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      is_admin      BOOLEAN      NOT NULL DEFAULT FALSE,
      read_only     BOOLEAN      NOT NULL DEFAULT FALSE,  -- view-only account
      data_owner    INT          NULL,                    -- whose data a view-only account sees
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
      read_only   BOOLEAN   NOT NULL DEFAULT FALSE,  -- invites a view-only account
      created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      used_by     INT       NULL
    ) CHARACTER SET utf8mb4
    SQL,
    <<<SQL
    CREATE TABLE IF NOT EXISTS view_links (  -- ?view=CODE shows the owner's map without logging in
      code        CHAR(24)     PRIMARY KEY,
      owner       INT          NOT NULL,
      label       VARCHAR(100) NOT NULL,
      created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX (owner)
    ) CHARACTER SET utf8mb4
    SQL,
    <<<SQL
    CREATE TABLE IF NOT EXISTS password_resets (
      code        CHAR(24)  PRIMARY KEY,
      user_id     INT       NOT NULL,
      created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      used_at     TIMESTAMP NULL
    ) CHARACTER SET utf8mb4
    SQL,
    <<<SQL
    CREATE TABLE IF NOT EXISTS strava_accounts (
      user_id       INT          PRIMARY KEY,
      athlete_id    BIGINT       NOT NULL,
      athlete_name  VARCHAR(255) NOT NULL,
      access_token  VARCHAR(255) NOT NULL,
      refresh_token VARCHAR(255) NOT NULL,
      expires_at    INT          NOT NULL,
      synced_until  INT          NOT NULL DEFAULT 0  -- start time (epoch) of the last activity looked at
    ) CHARACTER SET utf8mb4
    SQL,
    <<<SQL
    CREATE TABLE IF NOT EXISTS strava_events (  -- webhook events waiting to be handled
      id          INT AUTO_INCREMENT PRIMARY KEY,
      owner_id    BIGINT      NOT NULL,  -- Strava athlete id
      object_type VARCHAR(20) NOT NULL,
      object_id   BIGINT      NOT NULL,
      aspect_type VARCHAR(20) NOT NULL,
      received_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX (owner_id)
    ) CHARACTER SET utf8mb4
    SQL,
    <<<SQL
    CREATE TABLE IF NOT EXISTS areas (  -- street coverage areas, prepared by osm.js
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT          NOT NULL,
      osm_id      BIGINT       NOT NULL,  -- OSM boundary relation
      name        VARCHAR(255) NOT NULL,
      data        LONGTEXT     NOT NULL,  -- JSON: {boundary, hoods, streets}
      excluded    LONGTEXT     NULL,      -- JSON array of OSM way ids marked unrunnable
      fetched_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, osm_id)
    ) CHARACTER SET utf8mb4
    SQL,
    <<<SQL
    CREATE TABLE IF NOT EXISTS achievements (  -- earned once, kept even if coverage later drops
      user_id    INT          NOT NULL,
      code       VARCHAR(191) NOT NULL,  -- e.g. hood:12345:Brander Gardens:100
      title      VARCHAR(255) NOT NULL,
      detail     VARCHAR(255) NULL,
      earned_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, code)
    ) CHARACTER SET utf8mb4
    SQL,
    <<<SQL
    CREATE TABLE IF NOT EXISTS routes (  -- planned routes, drawn by planner.js
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT          NOT NULL,
      name        VARCHAR(255) NOT NULL,
      distance_m  DOUBLE       NOT NULL DEFAULT 0,
      data        LONGTEXT     NOT NULL,  -- JSON: {waypoints, legs, straight}
      created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX (user_id)
    ) CHARACTER SET utf8mb4
    SQL,
    <<<SQL
    CREATE TABLE IF NOT EXISTS settings (
      name  VARCHAR(64) PRIMARY KEY,
      value TEXT        NOT NULL
    ) CHARACTER SET utf8mb4
    SQL,
    <<<SQL
    CREATE TABLE IF NOT EXISTS strava_states (
      state       CHAR(32)  PRIMARY KEY,
      user_id     INT       NOT NULL,
      created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4
    SQL,
    <<<SQL
    CREATE TABLE IF NOT EXISTS tracks (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT          NULL,
      strava_id   BIGINT       NULL,
      name        VARCHAR(255) NOT NULL,
      sport       VARCHAR(40)  NULL,     -- e.g. Run, Ride, Hike; NULL if unknown
      simplified  BOOLEAN      NOT NULL DEFAULT FALSE,  -- geometry has been simplified
      file_name   VARCHAR(255) NOT NULL,
      color       VARCHAR(16)  NOT NULL,
      visible     BOOLEAN      NOT NULL DEFAULT TRUE,
      distance_m  DOUBLE       NOT NULL DEFAULT 0,
      track_time  VARCHAR(40)  NULL,
      added_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      geometry    LONGTEXT     NOT NULL,
      gpx         LONGTEXT     NOT NULL,
      INDEX (user_id),
      UNIQUE (user_id, strava_id)
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

// Compress responses: the track list can be several MB of coordinates.
// Flushing every 64 KB keeps the whole list from building up in memory.
if (!ini_get('zlib.output_compression')) {
    ob_start('ob_gzhandler', 65536);
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
        // ...nor a link back to the Strava activity they were imported from.
        if (!$pdo->query("SHOW COLUMNS FROM tracks LIKE 'strava_id'")->fetch()) {
            $pdo->exec('ALTER TABLE tracks ADD COLUMN strava_id BIGINT NULL AFTER user_id, ADD UNIQUE (user_id, strava_id)');
        }
        // ...nor the sport and simplified flag. Existing rows get simplified in list_tracks().
        if (!$pdo->query("SHOW COLUMNS FROM tracks LIKE 'sport'")->fetch()) {
            $pdo->exec('ALTER TABLE tracks ADD COLUMN sport VARCHAR(40) NULL AFTER name,
                        ADD COLUMN simplified BOOLEAN NOT NULL DEFAULT FALSE AFTER sport');
        }
        // View-only accounts came later too.
        if (!$pdo->query("SHOW COLUMNS FROM users LIKE 'read_only'")->fetch()) {
            $pdo->exec('ALTER TABLE users ADD COLUMN read_only BOOLEAN NOT NULL DEFAULT FALSE AFTER is_admin,
                        ADD COLUMN data_owner INT NULL AFTER read_only');
            $pdo->exec('ALTER TABLE invites ADD COLUMN read_only BOOLEAN NOT NULL DEFAULT FALSE AFTER created_by');
        }
        // ...and unrunnable streets.
        if (!$pdo->query("SHOW COLUMNS FROM areas LIKE 'excluded'")->fetch()) {
            $pdo->exec('ALTER TABLE areas ADD COLUMN excluded LONGTEXT NULL AFTER data');
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

// Hosts behind a proxy or load balancer report HTTPS in different ways.
function is_https(): bool {
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ($_SERVER['REQUEST_SCHEME'] ?? '') === 'https'
        || ($_SERVER['SERVER_PORT'] ?? '') === '443'
        || strtolower($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'
        || strtolower($_SERVER['HTTP_X_FORWARDED_SSL'] ?? '') === 'on';
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

// A view link stands in for a view-only account of its owner. It takes
// precedence over a session, so a member opening a club's link sees what the
// club sees. An unknown or turned-off code means nobody is logged in.
function view_link_user(string $code): ?array {
    if (!preg_match('/^[0-9a-f]{24}$/', $code)) {
        return null;
    }
    $stmt = db()->prepare('SELECT v.label, v.owner FROM view_links v JOIN users u ON u.id = v.owner WHERE v.code = ?');
    $stmt->execute([$code]);
    $row = $stmt->fetch();
    return $row ? ['id' => 0, 'username' => $row['label'], 'is_admin' => false, 'read_only' => true,
                   'data_owner' => (int) $row['owner'], 'view_link' => true] : null;
}

function current_user(): ?array {
    if (isset($_GET['view'])) {
        return view_link_user((string) $_GET['view']);
    }
    $token = $_COOKIE[SESSION_COOKIE] ?? '';
    if ($token === '') {
        return null;
    }
    $stmt = db()->prepare(
        'SELECT ' . USER_COLUMNS . ' FROM sessions s JOIN users u ON u.id = s.user_id
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
    $json = ['username' => $user['username'], 'isAdmin' => (bool) $user['is_admin'], 'readOnly' => !empty($user['read_only']),
             'viewLink' => !empty($user['view_link'])];
    if ($json['readOnly']) {
        $owner = db()->prepare('SELECT username FROM users WHERE id = ?');
        $owner->execute([$user['data_owner']]);
        $json['owner'] = $owner->fetchColumn() ?: '';
    }
    return $json;
}

function credentials(array $b): array {
    $username = trim($b['username'] ?? '');
    $password = $b['password'] ?? '';
    if (!preg_match('/^[A-Za-z0-9_.-]{3,32}$/', $username)) {
        fail('Username must be 3-32 letters, numbers, dots, dashes or underscores', 400);
    }
    return [$username, new_password($password)];
}

function new_password(string $password): string {
    if (strlen($password) < 8) {
        fail('Password must be at least 8 characters', 400);
    }
    return $password;
}

// $viewerOf: for a view-only account, the id of the user whose data it sees.
function create_user(string $username, string $password, bool $isAdmin, ?int $viewerOf = null): array {
    try {
        db()->prepare('INSERT INTO users (username, password_hash, is_admin, read_only, data_owner) VALUES (?, ?, ?, ?, ?)')
            ->execute([$username, password_hash($password, PASSWORD_DEFAULT), $isAdmin ? 1 : 0, $viewerOf ? 1 : 0, $viewerOf]);
    } catch (PDOException $e) {
        if (($e->errorInfo[1] ?? 0) === 1062) {
            fail('That username is taken', 409);
        }
        throw $e;
    }
    return ['id' => (int) db()->lastInsertId(), 'username' => $username, 'is_admin' => $isAdmin,
            'read_only' => (bool) $viewerOf, 'data_owner' => $viewerOf];
}

function needs_setup(): bool {
    return (int) db()->query('SELECT COUNT(*) FROM users')->fetchColumn() === 0;
}

function me(): array {
    $user = current_user();
    return ['user' => $user ? user_json($user) : null, 'needsSetup' => !$user && needs_setup(),
            'viewLinkOff' => !$user && isset($_GET['view'])];
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
    $stmt = db()->prepare('SELECT ' . USER_COLUMNS . ', u.password_hash FROM users u WHERE u.username = ?');
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
        'SELECT created_by, read_only FROM invites WHERE code = ? AND used_by IS NULL
         AND created_at > NOW() - INTERVAL ' . INVITE_DAYS . ' DAY FOR UPDATE'
    );
    $stmt->execute([$b['invite'] ?? '']);
    $invite = $stmt->fetch();
    if (!$invite) {
        $pdo->rollBack();
        fail('This invite link is invalid, already used, or expired', 403);
    }
    $user = create_user($username, $password, false, $invite['read_only'] ? (int) $invite['created_by'] : null);
    $pdo->prepare('UPDATE invites SET used_by = ? WHERE code = ?')->execute([$user['id'], $b['invite']]);
    $pdo->commit();
    start_session($user['id']);
    return user_json($user);
}

function create_invite(array $user): array {
    if (!$user['is_admin']) {
        fail('Only the admin can invite people', 403);
    }
    $viewer = !empty((json_decode(file_get_contents('php://input'), true) ?: [])['viewer']);
    $code = bin2hex(random_bytes(12));
    db()->prepare('INSERT INTO invites (code, created_by, read_only) VALUES (?, ?, ?)')
        ->execute([$code, $user['id'], $viewer ? 1 : 0]);
    return ['code' => $code];
}

// --- View links ---
// Made by any member for their own map; the code in the link is the only key.

function list_view_links(int $userId): array {
    $stmt = db()->prepare('SELECT code, label, created_at AS createdAt FROM view_links WHERE owner = ? ORDER BY created_at DESC');
    $stmt->execute([$userId]);
    return $stmt->fetchAll();
}

function create_view_link(int $userId, array $b): array {
    $label = mb_substr(trim((string) ($b['label'] ?? '')), 0, 100);
    if ($label === '') {
        fail('Give the link a name, like who it is for', 400);
    }
    $code = bin2hex(random_bytes(12));
    db()->prepare('INSERT INTO view_links (code, owner, label) VALUES (?, ?, ?)')->execute([$code, $userId, $label]);
    return ['code' => $code];
}

// Only the link's owner can turn it off; anyone else's request changes nothing.
function delete_view_link(int $userId, array $b): array {
    db()->prepare('DELETE FROM view_links WHERE owner = ? AND code = ?')->execute([$userId, (string) ($b['code'] ?? '')]);
    return ['ok' => true];
}

// --- Passwords ---
// No email: the admin sends reset links by hand, like invites. If the admin is
// locked out, app_password from feets-config.php resets any account.

// Saves a new password and logs the account out everywhere, then logs this
// browser back in.
function set_password(int $userId, string $password): void {
    db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        ->execute([password_hash($password, PASSWORD_DEFAULT), $userId]);
    db()->prepare('DELETE FROM sessions WHERE user_id = ?')->execute([$userId]);
    start_session($userId);
}

function find_user(string $username): ?array {
    $stmt = db()->prepare('SELECT ' . USER_COLUMNS . ', u.password_hash FROM users u WHERE u.username = ?');
    $stmt->execute([trim($username)]);
    return $stmt->fetch() ?: null;
}

function change_password(array $user, array $b): array {
    $full = find_user($user['username']);
    if (!password_verify($b['current'] ?? '', $full['password_hash'])) {
        usleep(random_int(400000, 800000));
        fail('Your current password is wrong', 403);
    }
    set_password((int) $user['id'], new_password($b['password'] ?? ''));
    return user_json($user);
}

function create_reset_link(array $admin, array $b): array {
    if (!$admin['is_admin']) {
        fail('Only the admin can reset passwords', 403);
    }
    $user = find_user($b['username'] ?? '');
    if (!$user) {
        fail('No user with that username', 404);
    }
    $code = bin2hex(random_bytes(12));
    db()->prepare('INSERT INTO password_resets (code, user_id) VALUES (?, ?)')->execute([$code, $user['id']]);
    return ['code' => $code, 'username' => $user['username']];
}

// The user a reset link is for, or null if it's unknown, used or expired.
function reset_link_user(string $code): ?array {
    $stmt = db()->prepare(
        'SELECT ' . USER_COLUMNS . ' FROM password_resets r JOIN users u ON u.id = r.user_id
         WHERE r.code = ? AND r.used_at IS NULL AND r.created_at > NOW() - INTERVAL ' . RESET_HOURS . ' HOUR'
    );
    $stmt->execute([$code]);
    return $stmt->fetch() ?: null;
}

function reset_info(): array {
    $user = reset_link_user($_GET['code'] ?? '');
    if (!$user) {
        fail('This reset link is invalid, already used, or expired. Ask for a new one.', 403);
    }
    return ['username' => $user['username']];
}

function reset_password(array $b): array {
    $code = (string) ($b['code'] ?? '');
    $user = reset_link_user($code);
    if (!$user) {
        fail('This reset link is invalid, already used, or expired. Ask for a new one.', 403);
    }
    $password = new_password($b['password'] ?? '');
    db()->prepare('UPDATE password_resets SET used_at = NOW() WHERE code = ?')->execute([$code]);
    set_password((int) $user['id'], $password);
    return user_json($user);
}

// "Forgot password" for the admin: app_password from feets-config.php unlocks any account.
function recover(array $b): array {
    global $config;
    $user = find_user($b['username'] ?? '');
    if (!$user || !hash_equals(trim($config['app_password']), trim($b['setupPassword'] ?? ''))) {
        usleep(random_int(400000, 800000));
        fail('Wrong setup password or username', 403);
    }
    set_password((int) $user['id'], new_password($b['password'] ?? ''));
    return user_json($user);
}

// --- Tracks ---

// Douglas-Peucker: drops points that lie within $tolerance metres of the
// simplified line, and rounds to 5 decimals (~1 m). A one-hour run recorded
// every second typically shrinks from ~3600 points to a few hundred.
function simplify_line(array $points, float $tolerance = 3.0): array {
    $n = count($points);
    if ($n < 3) {
        return array_map(fn($p) => [round((float) $p[0], 5), round((float) $p[1], 5)], $points);
    }
    // Project to metres on a flat plane; fine at the scale of one activity.
    $mPerDegree = 111320.0;
    $cos = cos(deg2rad((float) $points[0][0]));
    $xy = array_map(fn($p) => [(float) $p[1] * $mPerDegree * $cos, (float) $p[0] * $mPerDegree], $points);

    $keep = array_fill(0, $n, false);
    $keep[0] = $keep[$n - 1] = true;
    $limit = $tolerance * $tolerance;
    $stack = [[0, $n - 1]];
    while ($stack) {
        [$a, $b] = array_pop($stack);
        [$ax, $ay] = $xy[$a];
        $dx = $xy[$b][0] - $ax;
        $dy = $xy[$b][1] - $ay;
        $length2 = $dx * $dx + $dy * $dy;
        $farthest = 0.0;
        $index = -1;
        for ($i = $a + 1; $i < $b; $i++) {
            $px = $xy[$i][0] - $ax;
            $py = $xy[$i][1] - $ay;
            $t = $length2 > 0 ? max(0.0, min(1.0, ($px * $dx + $py * $dy) / $length2)) : 0.0;
            $ex = $px - $t * $dx;
            $ey = $py - $t * $dy;
            $d2 = $ex * $ex + $ey * $ey;
            if ($d2 > $farthest) {
                $farthest = $d2;
                $index = $i;
            }
        }
        if ($farthest > $limit) {
            $keep[$index] = true;
            $stack[] = [$a, $index];
            $stack[] = [$index, $b];
        }
    }
    $out = [];
    foreach ($points as $i => $p) {
        if ($keep[$i]) {
            $out[] = [round((float) $p[0], 5), round((float) $p[1], 5)];
        }
    }
    return $out;
}

function simplify_geometry(array $segments, array $waypoints): string {
    return json_encode(['segments' => array_map('simplify_line', $segments), 'waypoints' => $waypoints]);
}

// Turns a GPX <type> or Strava sport_type into a short label like Run or Ride.
function normalize_sport(?string $raw): ?string {
    $raw = trim((string) $raw);
    if ($raw === '' || ctype_digit($raw)) {
        return null;  // some devices write numeric codes
    }
    $known = [
        'run' => 'Run', 'running' => 'Run', 'trail_running' => 'TrailRun',
        'ride' => 'Ride', 'cycling' => 'Ride', 'biking' => 'Ride', 'road_biking' => 'Ride',
        'mountain_biking' => 'MountainBikeRide', 'walk' => 'Walk', 'walking' => 'Walk',
        'hike' => 'Hike', 'hiking' => 'Hike', 'swim' => 'Swim', 'swimming' => 'Swim',
        'open_water_swimming' => 'Swim',
    ];
    $key = strtolower(str_replace([' ', '-'], '_', $raw));
    return $known[$key] ?? mb_substr(ucfirst($raw), 0, 40);
}

// A track for the client, without its route.
function track_meta(array $row): array {
    return [
        'id' => (int) $row['id'],
        'name' => $row['name'],
        'sport' => $row['sport'] ?: null,
        'fileName' => $row['file_name'],
        'color' => $row['color'],
        'visible' => (bool) $row['visible'],
        'distance' => (float) $row['distance_m'],
        'time' => $row['track_time'],
    ];
}

function track_json(array $row): array {
    return track_meta($row) + json_decode($row['geometry'], true);
}

// Streams the track list as JSON. Each route is spliced in as the stored JSON
// text rather than decoded: thousands of decoded routes would exceed PHP's
// memory limit. Rows are read 200 at a time; any stored before simplification
// existed get simplified on the way.
function send_track_list(int $userId): void {
    @set_time_limit(120);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    echo '[';
    $first = true;
    $select = db()->prepare(
        'SELECT id, strava_id, name, sport, simplified, file_name, color, visible, distance_m, track_time, geometry,
                IF(simplified, NULL, gpx) AS gpx
         FROM tracks WHERE user_id = ? AND id > ? ORDER BY id LIMIT 200'
    );
    $update = db()->prepare('UPDATE tracks SET geometry = ?, sport = ?, simplified = 1 WHERE id = ?');
    $lastId = 0;
    do {
        $select->execute([$userId, $lastId]);
        $rows = $select->fetchAll();
        foreach ($rows as $row) {
            $lastId = (int) $row['id'];
            if (!$row['simplified']) {
                $geometry = json_decode($row['geometry'], true);
                $row['geometry'] = simplify_geometry($geometry['segments'], $geometry['waypoints']);
                // Uploaded GPX files may name the sport; Strava tracks get theirs from strava_sync.
                if ($row['sport'] === null && $row['strava_id'] === null
                    && preg_match('#<type>([^<]+)</type>#', (string) $row['gpx'], $m)) {
                    $row['sport'] = normalize_sport($m[1]);
                }
                $update->execute([$row['geometry'], $row['sport'], $row['id']]);
            }
            // {"id":…,"time":…} + {"segments":…,"waypoints":…} → one object
            echo $first ? '' : ',', substr(json_encode(track_meta($row)), 0, -1), ',', substr($row['geometry'], 1);
            $first = false;
        }
    } while (count($rows) === 200);
    echo ']';
    exit;
}

function add_track(int $userId, array $t): array {
    $stmt = db()->prepare(
        'INSERT INTO tracks (user_id, name, sport, simplified, file_name, color, visible, distance_m, track_time, geometry, gpx)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $userId,
        mb_substr($t['name'], 0, 255),
        normalize_sport($t['sport'] ?? null),
        mb_substr($t['fileName'], 0, 255),
        $t['color'],
        $t['visible'] ? 1 : 0,
        (float) $t['distance'],
        $t['time'] ?? null,
        simplify_geometry($t['segments'], $t['waypoints']),
        $t['gpx'],
    ]);
    return ['id' => (int) db()->lastInsertId()];
}

function set_visible(int $userId, array $b): array {
    $ids = array_values(array_unique(array_map('intval', $b['ids'] ?? [])));
    foreach (array_chunk($ids, 1000) as $chunk) {
        $marks = implode(',', array_fill(0, count($chunk), '?'));
        db()->prepare("UPDATE tracks SET visible = ? WHERE user_id = ? AND id IN ($marks)")
            ->execute(array_merge([$b['visible'] ? 1 : 0, $userId], $chunk));
    }
    return ['ok' => true];
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

// --- Strava ---
// OAuth2 docs: https://developers.strava.com/docs/authentication/

function strava_config(): ?array {
    global $config;
    $s = $config['strava'] ?? [];
    return !empty($s['client_id']) && !empty($s['client_secret']) ? $s : null;
}

// Absolute URL of a file next to api.php, e.g. app_url('') for the app itself.
function app_url(string $path): string {
    $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'])), '/');
    return (is_https() ? 'https' : 'http') . '://' . $_SERVER['HTTP_HOST'] . $dir . '/' . $path;
}

function redirect(string $url): void {
    header('Location: ' . $url, true, 302);
    exit;
}

// Returns [status, decoded JSON body].
function strava_http(string $method, string $url, array $params = [], array $headers = []): array {
    if ($method !== 'POST' && $params) {
        $url .= '?' . http_build_query($params);
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_CUSTOMREQUEST => $method,
    ]);
    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($params));
    }
    $body = curl_exec($ch);
    if ($body === false) {
        throw new RuntimeException('Could not reach Strava: ' . curl_error($ch));
    }
    return [curl_getinfo($ch, CURLINFO_HTTP_CODE), json_decode($body, true)];
}

function strava_status(int $userId): array {
    $stmt = db()->prepare('SELECT athlete_name FROM strava_accounts WHERE user_id = ?');
    $stmt->execute([$userId]);
    $row = $stmt->fetch();
    return [
        'configured' => strava_config() !== null,
        'connected' => (bool) $row,
        'athlete' => $row['athlete_name'] ?? null,
        'autoImport' => setting('strava_subscription_id') !== null,
    ];
}

function setting(string $name): ?string {
    $stmt = db()->prepare('SELECT value FROM settings WHERE name = ?');
    $stmt->execute([$name]);
    $value = $stmt->fetchColumn();
    return $value === false ? null : $value;
}

function set_setting(string $name, ?string $value): void {
    if ($value === null) {
        db()->prepare('DELETE FROM settings WHERE name = ?')->execute([$name]);
    } else {
        db()->prepare('REPLACE INTO settings (name, value) VALUES (?, ?)')->execute([$name, $value]);
    }
}

function strava_connect(int $userId): void {
    $strava = strava_config();
    if (!$strava) {
        fail('Strava is not set up in feets-config.php', 400);
    }
    // The state ties Strava's reply to this user and this browser (via the cookie).
    $state = bin2hex(random_bytes(16));
    db()->exec('DELETE FROM strava_states WHERE created_at < NOW() - INTERVAL 15 MINUTE');
    db()->prepare('INSERT INTO strava_states (state, user_id) VALUES (?, ?)')->execute([$state, $userId]);
    setcookie(STRAVA_STATE_COOKIE, $state, [
        'expires' => time() + 900,
        'path' => '/',
        'secure' => is_https(),
        'httponly' => true,
        'samesite' => 'Lax',  // must survive the redirect back from strava.com
    ]);
    redirect('https://www.strava.com/oauth/authorize?' . http_build_query([
        'client_id' => $strava['client_id'],
        'redirect_uri' => app_url('api.php?action=strava_callback'),
        'response_type' => 'code',
        'approval_prompt' => 'auto',
        'scope' => 'activity:read_all',
        'state' => $state,
    ]));
}

// Strava sends the browser here after the approval screen. The feets session
// cookie is SameSite=Strict, so it isn't sent on this cross-site redirect; the
// user comes from the stored state instead.
function strava_callback(): void {
    $back = function (string $status, string $message = '') {
        redirect(app_url('') . '?' . http_build_query(['strava' => $status, 'message' => $message]));
    };

    $state = $_GET['state'] ?? '';
    $cookieState = $_COOKIE[STRAVA_STATE_COOKIE] ?? '';
    setcookie(STRAVA_STATE_COOKIE, '', ['expires' => 1, 'path' => '/']);
    if ($state === '' || !hash_equals($cookieState, $state)) {
        $back('error', 'The Strava connection expired or was started in another browser. Please try again.');
    }
    $stmt = db()->prepare('SELECT user_id FROM strava_states WHERE state = ? AND created_at > NOW() - INTERVAL 15 MINUTE');
    $stmt->execute([$state]);
    $userId = (int) $stmt->fetchColumn();
    db()->prepare('DELETE FROM strava_states WHERE state = ?')->execute([$state]);
    if (!$userId) {
        $back('error', 'The Strava connection expired. Please try again.');
    }
    if (isset($_GET['error'])) {
        $back('error', 'Strava access was not granted.');
    }
    if (!preg_match('/\bactivity:read(_all)?\b/', $_GET['scope'] ?? '')) {
        $back('error', 'feets needs permission to view your activities. Connect again and leave that box ticked.');
    }

    $strava = strava_config();
    [$status, $token] = strava_http('POST', 'https://www.strava.com/oauth/token', [
        'client_id' => $strava['client_id'],
        'client_secret' => $strava['client_secret'],
        'code' => $_GET['code'] ?? '',
        'grant_type' => 'authorization_code',
    ]);
    if ($status !== 200 || empty($token['access_token'])) {
        $back('error', 'Strava refused the connection: ' . ($token['message'] ?? "HTTP $status"));
    }

    $athlete = $token['athlete'] ?? [];
    // Reconnecting the same Strava account keeps the import position.
    $stmt = db()->prepare('SELECT athlete_id, synced_until FROM strava_accounts WHERE user_id = ?');
    $stmt->execute([$userId]);
    $old = $stmt->fetch();
    $syncedUntil = ($old && (int) $old['athlete_id'] === (int) $athlete['id']) ? (int) $old['synced_until'] : 0;
    db()->prepare(
        'REPLACE INTO strava_accounts (user_id, athlete_id, athlete_name, access_token, refresh_token, expires_at, synced_until)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    )->execute([
        $userId,
        $athlete['id'],
        trim(($athlete['firstname'] ?? '') . ' ' . ($athlete['lastname'] ?? '')) ?: 'Strava athlete',
        $token['access_token'],
        $token['refresh_token'],
        $token['expires_at'],
        $syncedUntil,
    ]);
    $back('connected');
}

// The user's Strava account row, with a fresh access token.
function strava_account(int $userId): array {
    $stmt = db()->prepare('SELECT * FROM strava_accounts WHERE user_id = ?');
    $stmt->execute([$userId]);
    $account = $stmt->fetch();
    if (!$account) {
        fail('Strava is not connected', 400);
    }
    if ($account['expires_at'] < time() + 300) {
        $strava = strava_config();
        [$status, $token] = strava_http('POST', 'https://www.strava.com/oauth/token', [
            'client_id' => $strava['client_id'],
            'client_secret' => $strava['client_secret'],
            'grant_type' => 'refresh_token',
            'refresh_token' => $account['refresh_token'],
        ]);
        if ($status === 400 || $status === 401) {
            strava_forget($userId);
            fail('Strava access has been revoked. Please connect again.', 400);
        }
        if ($status !== 200) {
            throw new RuntimeException('Strava token refresh failed: ' . ($token['message'] ?? "HTTP $status"));
        }
        db()->prepare('UPDATE strava_accounts SET access_token = ?, refresh_token = ?, expires_at = ? WHERE user_id = ?')
            ->execute([$token['access_token'], $token['refresh_token'], $token['expires_at'], $userId]);
        $account = array_merge($account, $token);
    }
    return $account;
}

function strava_api(array $account, string $path, array $params = []): array {
    [$status, $data] = strava_http('GET', 'https://www.strava.com/api/v3' . $path, $params,
        ['Authorization: Bearer ' . $account['access_token']]);
    if ($status === 401) {
        strava_forget((int) $account['user_id']);
        fail('Strava access has been revoked. Please connect again.', 400);
    }
    return [$status, $data];
}

function strava_forget(int $userId): void {
    db()->prepare('DELETE FROM strava_accounts WHERE user_id = ?')->execute([$userId]);
}

// Activities that started after $after, oldest first. Strava doesn't document
// the sort order, so this checks it: if a full page comes back newest-first,
// it pages on until it reaches the oldest ones. 'full' means more may follow.
function strava_activities_after(array $account, int $after): array {
    $perPage = 200;
    $previous = [];
    for ($page = 1; ; $page++) {
        [$status, $batch] = strava_api($account, '/athlete/activities', ['after' => $after, 'per_page' => $perPage, 'page' => $page]);
        if ($status === 429) {
            return ['rateLimited' => true, 'list' => [], 'full' => true];
        }
        if ($status !== 200 || !is_array($batch)) {
            throw new RuntimeException('Strava activity list failed: ' . ($batch['message'] ?? "HTTP $status"));
        }
        if (!$batch && $previous) {
            $batch = $previous;  // the previous page held the oldest activities
            break;
        }
        $n = count($batch);
        $ascending = $n < 2 || strtotime($batch[0]['start_date']) <= strtotime($batch[$n - 1]['start_date']);
        if ($n < $perPage || $ascending) {
            break;
        }
        $previous = $batch;
    }
    usort($batch, fn($a, $b) => strtotime($a['start_date']) <=> strtotime($b['start_date']));
    // Newer pages remain if this page was full, or if we had to skip ahead past newer pages.
    return ['rateLimited' => false, 'list' => $batch, 'full' => count($batch) === $perPage || $page > 1];
}

function strava_gpx(string $name, int $start, array $latlng, array $times, array $altitudes): string {
    $x = fn($s) => htmlspecialchars($s, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    $iso = fn($t) => gmdate('Y-m-d\TH:i:s\Z', $t);
    $out = '<?xml version="1.0" encoding="UTF-8"?>' . "\n"
        . '<gpx version="1.1" creator="feets (imported from Strava)" xmlns="http://www.topografix.com/GPX/1/1">' . "\n"
        . '  <metadata><name>' . $x($name) . '</name><time>' . $iso($start) . "</time></metadata>\n"
        . '  <trk><name>' . $x($name) . "</name><trkseg>\n";
    foreach ($latlng as $i => [$lat, $lon]) {
        $out .= sprintf('    <trkpt lat="%.6f" lon="%.6f">', $lat, $lon);
        if (isset($altitudes[$i])) {
            $out .= sprintf('<ele>%.1f</ele>', $altitudes[$i]);
        }
        if (isset($times[$i])) {
            $out .= '<time>' . $iso($start + $times[$i]) . '</time>';
        }
        $out .= "</trkpt>\n";
    }
    return $out . "  </trkseg></trk>\n</gpx>\n";
}

// Saves one Strava activity as a track. Returns the track, or null if it was already imported.
function strava_save(int $userId, array $activity, array $streams): ?array {
    $latlng = $streams['latlng']['data'];
    $start = strtotime($activity['start_date']);
    $name = trim($activity['name'] ?? '') ?: 'Strava activity';
    $count = db()->prepare('SELECT COUNT(*) FROM tracks WHERE user_id = ?');
    $count->execute([$userId]);
    $row = [
        'name' => mb_substr($name, 0, 255),
        'sport' => strava_sport($activity),
        'file_name' => "strava-{$activity['id']}.gpx",
        'color' => TRACK_COLORS[$count->fetchColumn() % count(TRACK_COLORS)],
        'visible' => 1,
        'distance_m' => (float) ($activity['distance'] ?? 0),
        'track_time' => gmdate('Y-m-d\TH:i:s\Z', $start),
        'geometry' => simplify_geometry([$latlng], []),
    ];
    $gpx = strava_gpx($name, $start, $latlng, $streams['time']['data'] ?? [], $streams['altitude']['data'] ?? []);
    try {
        db()->prepare(
            'INSERT INTO tracks (user_id, strava_id, name, sport, simplified, file_name, color, visible, distance_m, track_time, geometry, gpx)
             VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([$userId, $activity['id'], $row['name'], $row['sport'], $row['file_name'], $row['color'], $row['visible'],
                    $row['distance_m'], $row['track_time'], $row['geometry'], $gpx]);
    } catch (PDOException $e) {
        if (($e->errorInfo[1] ?? 0) === 1062) {
            return null;  // already imported
        }
        throw $e;
    }
    return track_json(['id' => db()->lastInsertId()] + $row);
}

function strava_sport(array $activity): string {
    // '' (not NULL) marks "asked Strava, no sport given", so the backfill below finishes.
    return normalize_sport($activity['sport_type'] ?? $activity['type'] ?? null) ?? '';
}

// Tracks imported before feets stored the sport: fills it in from one page of
// Strava's activity list per call. Returns true if Strava's rate limit was hit.
function strava_backfill_sport(int $userId, array $account): bool {
    $stmt = db()->prepare('SELECT MIN(track_time) FROM tracks WHERE user_id = ? AND strava_id IS NOT NULL AND sport IS NULL');
    $stmt->execute([$userId]);
    $oldest = $stmt->fetchColumn();
    if (!$oldest) {
        return false;
    }
    $result = strava_activities_after($account, strtotime($oldest) - 1);
    if ($result['rateLimited']) {
        return true;
    }
    $update = db()->prepare('UPDATE tracks SET sport = ? WHERE user_id = ? AND strava_id = ?');
    foreach ($result['list'] as $activity) {
        $update->execute([strava_sport($activity), $userId, $activity['id']]);
    }
    // Tracks in the span covered whose activity is gone from Strava: mark them
    // unknown so the backfill doesn't ask about them forever.
    $list = $result['list'];
    if ($result['full'] && $list) {
        $until = gmdate('Y-m-d\TH:i:s\Z', strtotime($list[count($list) - 1]['start_date']));
        db()->prepare("UPDATE tracks SET sport = '' WHERE user_id = ? AND strava_id IS NOT NULL AND sport IS NULL AND track_time <= ?")
            ->execute([$userId, $until]);
    } elseif (!$result['full']) {
        db()->prepare("UPDATE tracks SET sport = '' WHERE user_id = ? AND strava_id IS NOT NULL AND sport IS NULL")
            ->execute([$userId]);
    }
    return false;
}

// Fetches one activity's GPS data and saves it as a track.
// Returns [track or null, whether Strava's rate limit was hit].
function strava_import_activity(int $userId, array $account, array $activity): array {
    // Treadmill runs and manual entries have no route.
    if (empty($activity['map']['summary_polyline']) || !empty($activity['manual'])) {
        return [null, false];
    }
    $exists = db()->prepare('SELECT 1 FROM tracks WHERE user_id = ? AND strava_id = ?');
    $exists->execute([$userId, $activity['id']]);
    if ($exists->fetchColumn()) {
        return [null, false];  // already imported, e.g. by a webhook event
    }
    [$status, $streams] = strava_api($account, "/activities/{$activity['id']}/streams",
        ['keys' => 'latlng,time,altitude', 'key_by_type' => 'true']);
    if ($status === 429) {
        return [null, true];
    }
    if ($status !== 200 || empty($streams['latlng']['data'])) {
        return [null, false];
    }
    return [strava_save($userId, $activity, $streams), false];
}

// Imports the next few activities. The client calls this repeatedly until done.
function strava_sync(int $userId): array {
    $started = time();
    $account = strava_account($userId);
    // Webhook events that couldn't be handled when they arrived.
    $events = strava_process_events((int) $account['athlete_id']);
    if ($events['rateLimited'] || strava_backfill_sport($userId, $account)) {
        return ['tracks' => $events['tracks'], 'done' => false, 'rateLimited' => true];
    }
    $cursor = (int) $account['synced_until'];
    $result = strava_activities_after($account, $cursor);
    $imported = $events['tracks'];
    $stoppedEarly = false;
    $rateLimited = $result['rateLimited'];

    foreach ($result['list'] as $activity) {
        if (count($imported) >= STRAVA_BATCH || time() - $started > STRAVA_TIME_BUDGET) {
            $stoppedEarly = true;
            break;
        }
        [$track, $limited] = strava_import_activity($userId, $account, $activity);
        if ($limited) {
            $rateLimited = true;
            break;
        }
        if ($track) {
            $imported[] = $track;
        }
        $cursor = max($cursor, strtotime($activity['start_date']));
    }

    db()->prepare('UPDATE strava_accounts SET synced_until = ? WHERE user_id = ?')->execute([$cursor, $userId]);
    return [
        'tracks' => $imported,
        'done' => !$stoppedEarly && !$rateLimited && !$result['full'],
        'rateLimited' => $rateLimited,
    ];
}

function strava_disconnect(int $userId): array {
    $stmt = db()->prepare('SELECT refresh_token FROM strava_accounts WHERE user_id = ?');
    $stmt->execute([$userId]);
    $refreshToken = $stmt->fetchColumn();
    $strava = strava_config();
    if ($refreshToken && $strava) {
        // Revoking the refresh token also revokes its access tokens. A failure here
        // isn't fatal: the user can also remove feets under My Apps on Strava.
        try {
            strava_http('POST', 'https://www.strava.com/oauth/revoke',
                ['token' => $refreshToken, 'token_type_hint' => 'refresh_token'],
                ['Authorization: Basic ' . base64_encode($strava['client_id'] . ':' . $strava['client_secret'])]);
        } catch (RuntimeException $e) {
            error_log('feets: Strava revoke failed: ' . $e->getMessage());
        }
    }
    strava_forget($userId);
    return ['ok' => true];
}

// --- Strava webhook ---
// With a subscription, Strava calls strava-webhook.php whenever a connected
// athlete creates, edits or deletes an activity, or disconnects feets.
// Docs: https://developers.strava.com/docs/webhooks/
//
// The calls aren't signed, so an event is only a hint: feets asks Strava about
// the activity itself before importing, renaming or deleting anything.

function strava_webhook_token(): string {
    return substr(hash_hmac('sha256', 'feets-strava-webhook', strava_config()['client_secret']), 0, 32);
}

function strava_webhook(): void {
    if (!strava_config()) {
        fail('Strava is not set up', 404);
    }
    while (ob_get_level()) {
        ob_end_clean();  // reply quickly, uncompressed
    }

    // Strava checks the URL when subscribing. PHP turns "hub.mode" into "hub_mode".
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        if (($_GET['hub_mode'] ?? '') !== 'subscribe'
            || !hash_equals(strava_webhook_token(), $_GET['hub_verify_token'] ?? '')) {
            fail('Bad verify token', 403);
        }
        send_json(['hub.challenge' => $_GET['hub_challenge'] ?? '']);
    }

    $event = json_decode(file_get_contents('php://input'), true);
    $ownerId = (int) ($event['owner_id'] ?? 0);
    $known = db()->prepare('SELECT COUNT(*) FROM strava_accounts WHERE athlete_id = ?');
    $known->execute([$ownerId]);
    if (is_array($event) && $known->fetchColumn()
        && in_array($event['object_type'] ?? '', ['activity', 'athlete'], true)
        && (string) ($event['subscription_id'] ?? '') === setting('strava_subscription_id')) {
        db()->prepare('INSERT INTO strava_events (owner_id, object_type, object_id, aspect_type) VALUES (?, ?, ?, ?)')
            ->execute([$ownerId, $event['object_type'], (int) $event['object_id'], (string) $event['aspect_type']]);
    } else {
        $ownerId = 0;
    }

    // Strava wants a 200 within 2 seconds, so answer first, then do the work
    // if the server lets this script keep running after the reply. If not,
    // the event waits until the athlete next opens feets.
    ignore_user_abort(true);
    $body = '{"ok":true}';
    header('Content-Type: application/json');
    header('Content-Length: ' . strlen($body));
    header('Connection: close');
    echo $body;
    flush();
    if ($ownerId && function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
        strava_process_events($ownerId);
    } elseif ($ownerId && function_exists('litespeed_finish_request')) {
        litespeed_finish_request();
        strava_process_events($ownerId);
    }
    exit;
}

// Handles waiting webhook events for one Strava athlete. Returns the tracks
// imported and whether Strava's rate limit was hit.
function strava_process_events(int $athleteId): array {
    $result = ['tracks' => [], 'rateLimited' => false];
    $users = db()->prepare('SELECT user_id FROM strava_accounts WHERE athlete_id = ?');
    $users->execute([$athleteId]);
    $userIds = $users->fetchAll(PDO::FETCH_COLUMN);
    $events = db()->prepare('SELECT * FROM strava_events WHERE owner_id = ? ORDER BY id LIMIT 20');
    $events->execute([$athleteId]);
    $done = db()->prepare('DELETE FROM strava_events WHERE id = ?');

    foreach ($events->fetchAll() as $event) {
        foreach ($userIds as $userId) {
            $outcome = strava_apply_event((int) $userId, strava_account((int) $userId), $event);
            if ($outcome === 'rate_limited') {
                $result['rateLimited'] = true;
                return $result;  // keep this event for next time
            }
            if (is_array($outcome)) {
                $result['tracks'][] = $outcome;
            }
        }
        $done->execute([$event['id']]);
    }
    db()->exec('DELETE FROM strava_events WHERE received_at < NOW() - INTERVAL 7 DAY');
    return $result;
}

// Returns a newly imported track, 'rate_limited', or null.
function strava_apply_event(int $userId, array $account, array $event) {
    if ($event['object_type'] === 'athlete') {
        // "Deauthorized": confirm by asking Strava. A revoked token gets 401,
        // and strava_api() then forgets the account.
        strava_api($account, '/athlete');
        return null;
    }
    $activityId = (int) $event['object_id'];
    $track = db()->prepare('SELECT id FROM tracks WHERE user_id = ? AND strava_id = ?');
    $track->execute([$userId, $activityId]);
    $trackId = $track->fetchColumn();

    [$status, $activity] = strava_api($account, "/activities/$activityId");
    if ($status === 429) {
        return 'rate_limited';
    }
    if ($status === 404) {
        // Really gone from Strava: remove it here too.
        if ($event['aspect_type'] === 'delete' && $trackId) {
            db()->prepare('DELETE FROM tracks WHERE id = ?')->execute([$trackId]);
        }
        return null;
    }
    if ($status !== 200 || !is_array($activity)) {
        throw new RuntimeException('Strava activity lookup failed: HTTP ' . $status);
    }
    if ($trackId) {
        // Renamed or changed type on Strava.
        db()->prepare('UPDATE tracks SET name = ?, sport = ? WHERE id = ?')
            ->execute([mb_substr(trim($activity['name'] ?? '') ?: 'Strava activity', 0, 255), strava_sport($activity), $trackId]);
        return null;
    }
    if ($event['aspect_type'] !== 'create') {
        return null;  // e.g. an edit to something deleted in feets: leave it deleted
    }
    [$imported, $limited] = strava_import_activity($userId, $account, $activity);
    return $limited ? 'rate_limited' : $imported;
}

function strava_error_text($data): string {
    $codes = array_map(fn($e) => trim(($e['field'] ?? '') . ' ' . ($e['code'] ?? '')), $data['errors'] ?? []);
    return trim(($data['message'] ?? 'Unknown error') . ($codes ? ': ' . implode('; ', $codes) : ''));
}

// $b['siteUrl'] is the app's address as the browser sees it, e.g.
// https://example.com/feets/. Strava doesn't follow redirects when it checks
// the callback, so it has to be exact, and the browser knows the scheme for
// sure; PHP behind a proxy may not. Only accepted for this site's own host.
function strava_auto_on(array $user, array $b): array {
    if (!$user['is_admin']) {
        fail('Only the admin can change this', 403);
    }
    $strava = strava_config();
    if (!$strava) {
        fail('Strava is not set up in feets-config.php', 400);
    }
    $site = (string) ($b['siteUrl'] ?? '');
    $parts = parse_url($site);
    $ownHost = strtolower(explode(':', $_SERVER['HTTP_HOST'] ?? '')[0]);
    if (!$parts || !in_array($parts['scheme'] ?? '', ['http', 'https'], true) || strtolower($parts['host'] ?? '') !== $ownHost) {
        $site = app_url('');
    }
    $callback = rtrim($site, '/') . '/strava-webhook.php';
    $credentials = ['client_id' => $strava['client_id'], 'client_secret' => $strava['client_secret']];
    // Strava calls the callback URL to check it before answering this request.
    [$status, $data] = strava_http('POST', 'https://www.strava.com/api/v3/push_subscriptions',
        $credentials + ['callback_url' => $callback, 'verify_token' => strava_webhook_token()]);
    if (($status === 200 || $status === 201) && isset($data['id'])) {
        set_setting('strava_subscription_id', (string) $data['id']);
        return ['ok' => true];
    }
    // Strava allows one subscription per app: if it already points here, use it.
    [, $existing] = strava_http('GET', 'https://www.strava.com/api/v3/push_subscriptions', $credentials);
    foreach (is_array($existing) ? $existing : [] as $sub) {
        if (($sub['callback_url'] ?? '') === $callback) {
            set_setting('strava_subscription_id', (string) $sub['id']);
            return ['ok' => true];
        }
    }
    fail('Strava refused: ' . strava_error_text($data) . " (Strava tried $callback)", 400);
}

function strava_auto_off(array $user): array {
    if (!$user['is_admin']) {
        fail('Only the admin can change this', 403);
    }
    $strava = strava_config();
    $id = setting('strava_subscription_id');
    if ($id && $strava) {
        [$status, $data] = strava_http('DELETE', "https://www.strava.com/api/v3/push_subscriptions/$id",
            ['client_id' => $strava['client_id'], 'client_secret' => $strava['client_secret']]);
        if ($status !== 204 && $status !== 404) {
            fail('Strava refused: ' . strava_error_text($data), 400);
        }
    }
    set_setting('strava_subscription_id', null);
    return ['ok' => true];
}

// --- Street coverage areas ---
// An area is an OSM boundary, e.g. a neighbourhood, with its roads, paths and
// trails. The browser fetches and prepares them from OpenStreetMap (osm.js) -
// Overpass can take minutes when busy, longer than shared hosting lets PHP
// run - and the server only stores the result. Coverage is worked out in the
// browser too (coverage.js).

const AREA_MAX_BYTES = 8 * 1024 * 1024;

// Area rows are sent with their stored JSON spliced in, not decoded and re-encoded.
function area_json(array $row): string {
    $meta = json_encode(['id' => (int) $row['id'], 'osmId' => (int) $row['osm_id'], 'name' => $row['name'], 'fetchedAt' => $row['fetched_at']]);
    return substr($meta, 0, -1) . ',"excluded":' . ($row['excluded'] ?: '[]') . ',"data":' . $row['data'] . '}';
}

function send_areas(int $userId, ?int $onlyId = null): void {
    $stmt = db()->prepare('SELECT * FROM areas WHERE user_id = ?' . ($onlyId ? ' AND id = ?' : '') . ' ORDER BY name');
    $stmt->execute($onlyId ? [$userId, $onlyId] : [$userId]);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    $rows = array_map('area_json', $stmt->fetchAll());
    echo $onlyId ? ($rows[0] ?? 'null') : '[' . implode(',', $rows) . ']';
    exit;
}

// Stores an area prepared by the browser: {osmId, name, data}. Adding one
// that's already there replaces it (that's how "refresh" works).
function area_save(int $userId, array $b): void {
    $osmId = (int) ($b['osmId'] ?? 0);
    $name = trim((string) ($b['name'] ?? ''));
    $data = $b['data'] ?? null;
    if ($osmId <= 0 || $name === '' || !is_array($data) || !is_array($data['streets'] ?? null)) {
        fail('Incomplete area data', 400);
    }
    $json = json_encode($data);
    if (strlen($json) > AREA_MAX_BYTES) {
        fail('That area is too big. Pick a smaller one, like a neighbourhood.', 400);
    }
    $stmt = db()->prepare('SELECT id FROM areas WHERE user_id = ? AND osm_id = ?');
    $stmt->execute([$userId, $osmId]);
    $id = (int) $stmt->fetchColumn();
    if ($id) {
        db()->prepare('UPDATE areas SET name = ?, data = ?, fetched_at = CURRENT_TIMESTAMP WHERE id = ?')
            ->execute([mb_substr($name, 0, 255), $json, $id]);
    } else {
        db()->prepare('INSERT INTO areas (user_id, osm_id, name, data) VALUES (?, ?, ?, ?)')
            ->execute([$userId, $osmId, mb_substr($name, 0, 255), $json]);
        $id = (int) db()->lastInsertId();
    }
    send_areas($userId, $id);
}

// Marks OSM ways unrunnable (excluded = true) or counts them again. Stored by
// way id, separately from the street data, so refreshing the area keeps them.
function area_exclude(int $userId, int $id, array $b): array {
    $stmt = db()->prepare('SELECT excluded FROM areas WHERE user_id = ? AND id = ?');
    $stmt->execute([$userId, $id]);
    $row = $stmt->fetch();
    if (!$row) {
        fail('Area not found', 404);
    }
    $set = array_flip(json_decode($row['excluded'] ?: '[]', true));
    foreach ($b['ways'] ?? [] as $way) {
        if (!empty($b['excluded'])) {
            $set[(int) $way] = true;
        } else {
            unset($set[(int) $way]);
        }
    }
    $excluded = array_map('intval', array_keys($set));
    sort($excluded);
    db()->prepare('UPDATE areas SET excluded = ? WHERE id = ?')->execute([json_encode($excluded), $id]);
    return ['excluded' => $excluded];
}

function area_delete(int $userId, int $id): array {
    db()->prepare('DELETE FROM areas WHERE user_id = ? AND id = ?')->execute([$userId, $id]);
    return ['ok' => true];
}

// --- Planned routes ---

const ROUTE_MAX_BYTES = 2 * 1024 * 1024;

// Like areas, rows are sent with their stored JSON spliced in.
function route_json(array $row): string {
    $meta = json_encode(['id' => (int) $row['id'], 'name' => $row['name'], 'distance' => (float) $row['distance_m'],
                         'createdAt' => $row['created_at'], 'updatedAt' => $row['updated_at']]);
    return substr($meta, 0, -1) . ',"data":' . $row['data'] . '}';
}

// All of the user's routes, last changed first, or just one ($onlyId).
function send_routes(int $userId, ?int $onlyId = null): void {
    $stmt = db()->prepare('SELECT * FROM routes WHERE user_id = ?' . ($onlyId ? ' AND id = ?' : '') . ' ORDER BY updated_at DESC, id DESC');
    $stmt->execute($onlyId ? [$userId, $onlyId] : [$userId]);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    $rows = array_map('route_json', $stmt->fetchAll());
    echo $onlyId ? ($rows[0] ?? 'null') : '[' . implode(',', $rows) . ']';
    exit;
}

// Stores a route drawn by the browser: {id?, name, distance, data}. With an
// id it replaces that route, if it's the user's own.
function route_save(int $userId, array $b): void {
    $name = mb_substr(trim((string) ($b['name'] ?? '')), 0, 255);
    $data = $b['data'] ?? null;
    if ($name === '' || !is_array($data) || !is_array($data['waypoints'] ?? null) || !is_array($data['legs'] ?? null)) {
        fail('Incomplete route', 400);
    }
    $json = json_encode($data);
    if (strlen($json) > ROUTE_MAX_BYTES) {
        fail('That route is too long to save', 400);
    }
    $distance = max(0, (float) ($b['distance'] ?? 0));
    $id = (int) ($b['id'] ?? 0);
    if ($id) {
        $stmt = db()->prepare('UPDATE routes SET name = ?, distance_m = ?, data = ? WHERE id = ? AND user_id = ?');
        $stmt->execute([$name, $distance, $json, $id, $userId]);
        $check = db()->prepare('SELECT id FROM routes WHERE id = ? AND user_id = ?');
        $check->execute([$id, $userId]);
        if (!$check->fetchColumn()) {
            fail('Route not found', 404);
        }
    } else {
        db()->prepare('INSERT INTO routes (user_id, name, distance_m, data) VALUES (?, ?, ?, ?)')
            ->execute([$userId, $name, $distance, $json]);
        $id = (int) db()->lastInsertId();
    }
    send_routes($userId, $id);
}

function route_rename(int $userId, int $id, array $b): void {
    $name = mb_substr(trim((string) ($b['name'] ?? '')), 0, 255);
    if ($name === '') {
        fail('A route needs a name', 400);
    }
    $stmt = db()->prepare('SELECT id FROM routes WHERE id = ? AND user_id = ?');
    $stmt->execute([$id, $userId]);
    if (!$stmt->fetchColumn()) {
        fail('Route not found', 404);
    }
    db()->prepare('UPDATE routes SET name = ? WHERE id = ?')->execute([$name, $id]);
    send_routes($userId, $id);
}

function route_delete(int $userId, int $id): array {
    db()->prepare('DELETE FROM routes WHERE user_id = ? AND id = ?')->execute([$userId, $id]);
    return ['ok' => true];
}

// --- Achievements ---

function list_achievements(int $userId): array {
    $stmt = db()->prepare('SELECT code, title, detail, earned_at AS earnedAt FROM achievements WHERE user_id = ? ORDER BY earned_at, code');
    $stmt->execute([$userId]);
    return $stmt->fetchAll();
}

// Saves newly earned achievements and returns the full list. INSERT IGNORE
// keeps the first earned date of a code the browser sends again; at most 200
// are taken per request.
function add_achievements(int $userId, array $b): array {
    $insert = db()->prepare('INSERT IGNORE INTO achievements (user_id, code, title, detail) VALUES (?, ?, ?, ?)');
    foreach (array_slice($b['achievements'] ?? [], 0, 200) as $a) {
        $code = mb_substr(trim((string) ($a['code'] ?? '')), 0, 191);
        $title = mb_substr(trim((string) ($a['title'] ?? '')), 0, 255);
        if ($code === '' || $title === '') {
            continue;
        }
        $detail = isset($a['detail']) ? mb_substr((string) $a['detail'], 0, 255) : null;
        $insert->execute([$userId, $code, $title, $detail]);
    }
    return list_achievements($userId);
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
} elseif ($method === 'GET' && $action === 'reset_info') {
    send_json(reset_info());
} elseif ($method === 'POST' && $action === 'reset_password') {
    send_json(reset_password(read_json()));
} elseif ($method === 'POST' && $action === 'recover') {
    send_json(recover(read_json()));
} elseif ($method === 'GET' && $action === 'strava_callback') {
    strava_callback();
} elseif ($action === 'strava_webhook') {
    strava_webhook();
}

$user = require_user();
$userId = (int) $user['id'];

// View-only accounts may only read their inviter's tracks and areas.
// Everything else - uploads, edits, deletes, downloads, Strava, settings - is refused here.
// View links are narrower still: they show saved routes and nothing else.
if (!empty($user['read_only'])) {
    $userId = (int) $user['data_owner'];
    if ($method === 'GET' && $action === 'strava_status') {
        send_json(['configured' => false, 'connected' => false, 'athlete' => null, 'autoImport' => false]);
    }
    $readable = !empty($user['view_link']) ? ['routes'] : ['', 'areas', 'achievements', 'routes'];
    if ($method !== 'GET' || !in_array($action, $readable, true) || isset($_GET['gpx'])) {
        fail('This is a view-only account', 403);
    }
}

if ($method === 'POST' && $action === 'invite') {
    send_json(create_invite($user));
} elseif ($method === 'GET' && $action === 'view_links') {
    send_json(list_view_links($userId));
} elseif ($method === 'POST' && $action === 'view_link_create') {
    send_json(create_view_link($userId, read_json()));
} elseif ($method === 'POST' && $action === 'view_link_delete') {
    send_json(delete_view_link($userId, read_json()));
} elseif ($method === 'POST' && $action === 'change_password') {
    send_json(change_password($user, read_json()));
} elseif ($method === 'POST' && $action === 'reset_link') {
    send_json(create_reset_link($user, read_json()));
} elseif ($method === 'GET' && $action === 'strava_status') {
    send_json(strava_status($userId));
} elseif ($method === 'GET' && $action === 'strava_connect') {
    strava_connect($userId);
} elseif ($method === 'POST' && $action === 'strava_sync') {
    send_json(strava_sync($userId));
} elseif ($method === 'POST' && $action === 'strava_disconnect') {
    send_json(strava_disconnect($userId));
} elseif ($method === 'GET' && $action === 'areas') {
    send_areas($userId);
} elseif ($method === 'POST' && $action === 'area_save') {
    area_save($userId, read_json());
} elseif ($method === 'POST' && $action === 'area_delete' && $id) {
    send_json(area_delete($userId, $id));
} elseif ($method === 'POST' && $action === 'area_exclude' && $id) {
    send_json(area_exclude($userId, $id, read_json()));
} elseif ($method === 'GET' && $action === 'routes') {
    send_routes($userId);
} elseif ($method === 'POST' && $action === 'route_save') {
    route_save($userId, read_json());
} elseif ($method === 'POST' && $action === 'route_rename' && $id) {
    route_rename($userId, $id, read_json());
} elseif ($method === 'POST' && $action === 'route_delete' && $id) {
    send_json(route_delete($userId, $id));
} elseif ($method === 'GET' && $action === 'achievements') {
    send_json(list_achievements($userId));
} elseif ($method === 'POST' && $action === 'achievement_add') {
    send_json(add_achievements($userId, read_json()));
} elseif ($method === 'POST' && $action === 'strava_auto_on') {
    send_json(strava_auto_on($user, read_json()));
} elseif ($method === 'POST' && $action === 'strava_auto_off') {
    send_json(strava_auto_off($user));
} elseif ($method === 'GET' && isset($_GET['gpx'])) {
    download_gpx($userId, (int) $_GET['gpx']);
} elseif ($method === 'GET') {
    send_track_list($userId);
} elseif ($method === 'POST' && $action === 'add') {
    send_json(add_track($userId, read_json()));
} elseif ($method === 'POST' && $action === 'update' && $id) {
    send_json(update_track($userId, $id, read_json()));
} elseif ($method === 'POST' && $action === 'set_visible') {
    send_json(set_visible($userId, read_json()));
} elseif ($method === 'POST' && $action === 'delete' && $id) {
    send_json(delete_track($userId, $id));
} else {
    fail('Unknown request', 404);
}
