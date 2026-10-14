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
//
// Strava (each user connects their own account)
//   GET  api.php?action=strava_status      {configured, connected, athlete}
//   GET  api.php?action=strava_connect     page navigation: redirects to Strava's approval screen
//   GET  api.php?action=strava_callback    Strava redirects back here, then on to the app
//   POST api.php?action=strava_sync        imports the next batch, returns {tracks, done, rateLimited}
//   POST api.php?action=strava_disconnect

const SESSION_COOKIE = 'feets_session';
const SESSION_DAYS = 30;
const INVITE_DAYS = 7;

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

function track_json(array $row): array {
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
}

function list_tracks(int $userId): array {
    $stmt = db()->prepare(
        'SELECT id, name, file_name, color, visible, distance_m, track_time, geometry
         FROM tracks WHERE user_id = ? ORDER BY id'
    );
    $stmt->execute([$userId]);
    return array_map('track_json', $stmt->fetchAll());
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
    if ($method === 'GET' && $params) {
        $url .= '?' . http_build_query($params);
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => $headers,
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
    return ['configured' => strava_config() !== null, 'connected' => (bool) $row, 'athlete' => $row['athlete_name'] ?? null];
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
        'file_name' => "strava-{$activity['id']}.gpx",
        'color' => TRACK_COLORS[$count->fetchColumn() % count(TRACK_COLORS)],
        'visible' => 1,
        'distance_m' => (float) ($activity['distance'] ?? 0),
        'track_time' => gmdate('Y-m-d\TH:i:s\Z', $start),
        'geometry' => json_encode(['segments' => [$latlng], 'waypoints' => []]),
    ];
    $gpx = strava_gpx($name, $start, $latlng, $streams['time']['data'] ?? [], $streams['altitude']['data'] ?? []);
    try {
        db()->prepare(
            'INSERT INTO tracks (user_id, strava_id, name, file_name, color, visible, distance_m, track_time, geometry, gpx)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([$userId, $activity['id'], $row['name'], $row['file_name'], $row['color'], $row['visible'],
                    $row['distance_m'], $row['track_time'], $row['geometry'], $gpx]);
    } catch (PDOException $e) {
        if (($e->errorInfo[1] ?? 0) === 1062) {
            return null;  // already imported
        }
        throw $e;
    }
    return track_json(['id' => db()->lastInsertId()] + $row);
}

// Imports the next few activities. The client calls this repeatedly until done.
function strava_sync(int $userId): array {
    $started = time();
    $account = strava_account($userId);
    $cursor = (int) $account['synced_until'];
    $result = strava_activities_after($account, $cursor);
    $imported = [];
    $stoppedEarly = false;
    $rateLimited = $result['rateLimited'];

    foreach ($result['list'] as $activity) {
        if (count($imported) >= STRAVA_BATCH || time() - $started > STRAVA_TIME_BUDGET) {
            $stoppedEarly = true;
            break;
        }
        // Treadmill runs and manual entries have no route.
        $hasRoute = !empty($activity['map']['summary_polyline']) && empty($activity['manual']);
        if ($hasRoute) {
            [$status, $streams] = strava_api($account, "/activities/{$activity['id']}/streams",
                ['keys' => 'latlng,time,altitude', 'key_by_type' => 'true']);
            if ($status === 429) {
                $rateLimited = true;
                break;
            }
            if ($status === 200 && !empty($streams['latlng']['data'])) {
                $track = strava_save($userId, $activity, $streams);
                if ($track) {
                    $imported[] = $track;
                }
            }
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
} elseif ($method === 'GET' && $action === 'strava_callback') {
    strava_callback();
}

$user = require_user();
$userId = (int) $user['id'];

if ($method === 'POST' && $action === 'invite') {
    send_json(create_invite($user));
} elseif ($method === 'GET' && $action === 'strava_status') {
    send_json(strava_status($userId));
} elseif ($method === 'GET' && $action === 'strava_connect') {
    strava_connect($userId);
} elseif ($method === 'POST' && $action === 'strava_sync') {
    send_json(strava_sync($userId));
} elseif ($method === 'POST' && $action === 'strava_disconnect') {
    send_json(strava_disconnect($userId));
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
