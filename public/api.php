<?php
// feets API: user accounts and GPX tracks, stored in MySQL. Called by store.js.
//
// Accounts
//   GET  api.php?action=me             {user, needsSetup, viewLinkOff, site: {name, sport}}
//                                      site: the name and primary sport from feets-config.php
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
//   GET  api.php?action=view_links     the user's view links: [{code, label, createdAt, expiresAt}]
//                                      expiresAt: Unix ms, or null for a link that never expires
//   POST api.php?action=view_link_create  {label, days}, returns {code, days}. days: 1-365, or 0 for no
//                                         expiry; only the admin's is used, others get VIEW_LINK_DAYS
//   POST api.php?action=view_link_delete  {code}
//   GET  api.php?action=admin_overview    admin only: {users: [{id, username, kind (admin, member or viewer),
//                                         owner, createdAt, tracks, signedIn, self}], viewLinks: [{code, label,
//                                         owner, createdAt, expiresAt}], invites: [{code, kind, createdAt}]}
//   POST api.php?action=admin_user_delete     admin only: {id}: the account and everything that's theirs
//   POST api.php?action=admin_user_sign_out   admin only: {id}: logs the account out everywhere
//   POST api.php?action=admin_view_link_delete  admin only: {code}, anyone's link
//   POST api.php?action=admin_invite_delete   admin only: {code}, an invite not yet used
//
// View links: any request with ?view=CODE is answered as a view-only account
// of the link's owner that can only list saved routes, with no login, until
// the owner turns the link off or it expires. The admin's links last as long
// as they choose; everyone else's last VIEW_LINK_DAYS.
//
// Tracks (must be logged in; each user only sees their own)
//   GET  api.php                       list tracks
//   GET  api.php?gpx=ID                download the original GPX file
//   POST api.php?action=add            body: track JSON, returns {id, metrics, sport}
//   POST api.php?action=update&id=ID   body: {visible, color}
//   POST api.php?action=set_visible    body: {ids, visible}  show or hide many tracks at once
//   POST api.php?action=delete&id=ID
//   POST api.php?action=track_metrics  works out pace, time and elevation for older tracks, a batch at a time:
//                                      {metrics: {id: metrics}, remaining}
//   GET  api.php?action=track_profile&id=ID  {profile: [[km, metres]] or null}
//   GET  api.php?action=track_points&id=ID   every point in the GPX, for removing stray ones and for ghost
//                                      races: {points: [[lat, lon, segment, time (Unix seconds, or null)]]}
//   POST api.php?action=track_edit&id=ID     {remove: [point indexes, as in track_points]}: takes those points out of
//                                      the GPX and works the track out again; returns the track, as in the list
//
// Routes are stored simplified (to ~3 m) for drawing; the original GPX is kept for download.
//
// Strava (each user connects their own account)
//   GET  api.php?action=strava_status      {configured, connected, athlete}
//   GET  api.php?action=strava_connect     page navigation: redirects to Strava's approval screen
//   GET  api.php?action=strava_callback    Strava redirects back here, then on to the app
//   POST api.php?action=strava_sync        imports the next batch, returns {tracks, done, rateLimited}
//   POST api.php?action=strava_refresh     {before?}: picks up names and types changed on Strava, a page of
//                                          200 activities at a time; returns {changed, checked, next, rateLimited}
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
//   GET  api.php?action=way_names            your names for OSM ways that have none: {way id: name}
//   POST api.php?action=way_names_save       {ways, name}: names those ways; an empty name takes the name off.
//                                            Returns what GET does
//   POST api.php?action=area_scan_claim      a turn at looking for places you run without an area (see
//                                            area_scan_claim): {go, skip: [cell keys not to try again]}
//   POST api.php?action=area_scan_save       {on?, skip?: [cell keys], result?, retry?}: switch it on or off, add places
//                                            not to try, note how a turn went, or give back a turn OSM was too busy for
//
// Planned routes (drawn in the browser by planner.js)
//   GET  api.php?action=routes               all of the user's routes, newest first
//   POST api.php?action=route_save           {id?, name, distance, data}; with id, replaces that route. Returns it
//   POST api.php?action=route_rename&id=ID   {name}, returns the route
//   POST api.php?action=route_delete&id=ID
//
// Goals
//   GET  api.php?action=goals                {week, month} in km, null when not set
//   POST api.php?action=goals_save           {week, month}, returns the goals
//   GET  api.php?action=segments             your segments: [{id, name, distance, points, createdAt,
//                                            efforts: {track id: [[start, seconds], ...]}}]
//   POST api.php?action=segment_save         {name, points, distance}, returns the segment
//   POST api.php?action=segment_rename&id=ID {name}
//   POST api.php?action=segment_delete&id=ID
//   GET  api.php?action=art_shapes           your own GPS art shapes (see Art.trace): [{id, name, points, createdAt}]
//   POST api.php?action=art_shape_save       {name, points: [[x, y], ...] in a unit box}, returns the shape
//   POST api.php?action=art_shape_delete&id=ID
//   POST api.php?action=segment_efforts&id=ID  {efforts: {track id: [[start, seconds], ...]}}: what the
//                                            browser found, kept so each activity is only checked once
//   GET  api.php?action=quests               this week's quests: {week, quests, done: [ids], completed, boss, bossDone,
//                                            shields: {held, used: [week ids], earned: [week ids]}, expedition,
//                                            expeditionAt, expeditionLast, expeditions}, see save_quests()
//   POST api.php?action=quests_save          {week, quests, done, completed, boss, bossDone, shields, expedition…}
//   POST api.php?action=home_save            {lat, lon, zoom}: where the map opens; {} clears it. Returns {home}
//                                            (sent as user.home by me, login and the like; null when not set)
//
// Virtual races: a course, copied from one of your saved routes, and a time window. Anyone with the
// race's link (race.html?code=CODE) sees its leaderboard and can enter, no login needed (see race_time)
//   GET  api.php?action=races                your races: [{id, code, name, distance, startsAt, endsAt, entries}]
//   POST api.php?action=race_create          {routeId, name, startsAt, endsAt} (Unix ms), returns the race
//   POST api.php?action=race_update&id=ID    {name?, startsAt?, endsAt?}, returns the race
//   POST api.php?action=race_delete&id=ID    the race and its times
//   POST api.php?action=race_entry_delete    {id}: takes a time off one of your races
//   GET  api.php?action=race&code=CODE[&entrant=KEY]  anyone: {name, host, distance, course, startsAt, endsAt,
//                                            closesAt, mine, entries: [{id, name, seconds, startedAt, yours}]}, fastest
//                                            first. entrant: the browser's key, to mark its own time (yours)
//   POST api.php?action=race_enter&code=CODE {name, entrant, gpx}: anyone, while uploads are open. Returns
//                                            {counted, why?, seconds?, startedAt?, best?, race}; a slower time than
//                                            the entrant's best only changes their name

// Achievements (worked out in the browser by achievements.js; the server only remembers them)
//   GET  api.php?action=achievements         [{code, title, detail, earnedAt}], oldest first
//   POST api.php?action=achievement_add      {achievements: [{code, title, detail}]}; already-earned codes are ignored
//
// Cards (worked out in the browser by cards.js; the server only remembers which were found)
//   GET  api.php?action=cards                {since, lookedBack, cards: [{code, detail, earnedAt}]}, oldest first. since
//                                            (Unix ms): when the account's activities started finding cards, set on the
//                                            first call; lookedBack: the one-time look back for past travels is done
//   POST api.php?action=cards_looked_back    marks that look back done; returns what GET does
//   POST api.php?action=card_add             {cards: [{code, detail}]}; codes already found are ignored. Returns
//                                            what GET does

// Experience points (worked out in the browser by xp.js; the server keeps the ledger, see add_xp)
//   GET  api.php?action=xp                   {since, total, recent, refs, idle}: since (Unix ms) is when the
//                                            account's XP started counting, set on the first call; recent: the
//                                            last few events; refs: every ref in the ledger, so they aren't sent
//                                            again; idle: {ref: points} of the idle days kept
//   POST api.php?action=xp_add               {events: [{kind, ref, track?, points, detail}], retract?: [refs]}; refs
//                                            already in the ledger are ignored. Losses (idle, missed) have points
//                                            from -1000 to 0; retract takes back idle days that weren't idle after
//                                            all. Returns what GET does, plus added: [refs]

const SESSION_COOKIE = 'feets_session';
const SESSION_DAYS = 30;
const INVITE_DAYS = 7;
const VIEW_LINK_DAYS = 7;  // how long a view link lasts, except the admin's: theirs can be set
const RESET_HOURS = 48;

// Password guessing: within LOGIN_WINDOW minutes, a username gets
// LOGIN_MAX_PER_USER tries and an IP address LOGIN_MAX_PER_IP. Past that,
// even the right password is refused until the window has passed.
const LOGIN_WINDOW = 15;
const LOGIN_MAX_PER_USER = 5;
const LOGIN_MAX_PER_IP = 20;

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
      goals         TEXT         NULL,                    -- JSON: { week, month } in km, see save_goals()
      home          TEXT         NULL,                    -- JSON: { lat, lon, zoom }, where the map opens
      area_scan     TEXT         NULL,                    -- JSON: { off, last, skipped, result }, see area_scan_claim()
      quests        TEXT         NULL,                    -- JSON: this week's quests, see save_quests()
      xp_since      TIMESTAMP    NULL,                    -- when experience points started counting, see xp()
      cards_since   TIMESTAMP    NULL,                    -- when activities started finding cards, see list_cards()
      cards_lookback TIMESTAMP   NULL,                    -- when the one-time look back for past travels was done
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
      expires_at  TIMESTAMP    NULL,  -- NULL: works until turned off
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
    CREATE TABLE IF NOT EXISTS xp_events (  -- experience points earned, one row per thing that earned them
      user_id   INT          NOT NULL,
      ref       VARCHAR(150) NOT NULL,  -- what earned them, e.g. activity:123 or quest:2026-10-19:any
      kind      VARCHAR(20)  NOT NULL,  -- activity, streets, best, segment, streak, quest, trophy; losses: idle, missed
      track_id  INT          NULL,      -- the activity it came from, if any: deleting it takes the points away
      points    INT          NOT NULL,
      detail    VARCHAR(255) NULL,
      earned_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, ref),
      INDEX (track_id)
    ) CHARACTER SET utf8mb4
    SQL,
    <<<SQL
    CREATE TABLE IF NOT EXISTS login_attempts (  -- recent password tries, see count_login_try()
      id        INT AUTO_INCREMENT PRIMARY KEY,
      username  VARCHAR(32) NOT NULL,  -- lower case; '' for the setup password
      ip        VARCHAR(45) NOT NULL,
      tried_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX (username, tried_at),
      INDEX (ip, tried_at)
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
    CREATE TABLE IF NOT EXISTS way_names (  -- your names for OSM ways that have none, in every area
      user_id  INT          NOT NULL,
      way_id   BIGINT       NOT NULL,
      name     VARCHAR(255) NOT NULL,
      PRIMARY KEY (user_id, way_id)
    ) CHARACTER SET utf8mb4
    SQL,
    <<<SQL
    CREATE TABLE IF NOT EXISTS races (  -- virtual races, see race_time()
      id          INT AUTO_INCREMENT PRIMARY KEY,
      code        CHAR(24)     NOT NULL UNIQUE,  -- in the race's link
      owner       INT          NOT NULL,
      name        VARCHAR(100) NOT NULL,
      course      MEDIUMTEXT   NOT NULL,  -- JSON [[lat, lon], ...], copied from a route so editing it changes nothing
      distance_m  DOUBLE       NOT NULL,
      starts_at   INT          NOT NULL,  -- Unix seconds: runs between these count
      ends_at     INT          NOT NULL,
      created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX (owner)
    ) CHARACTER SET utf8mb4
    SQL,
    <<<SQL
    CREATE TABLE IF NOT EXISTS race_entries (  -- each entrant's best time; never their activity
      id          INT AUTO_INCREMENT PRIMARY KEY,
      race_id     INT          NOT NULL,
      entrant     CHAR(32)     NOT NULL,  -- a key their browser made, so a faster run replaces a slower one
      name        VARCHAR(60)  NOT NULL,
      seconds     INT          NOT NULL,
      started_at  INT          NOT NULL,  -- Unix seconds, when they crossed the start
      added_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (race_id, entrant)
    ) CHARACTER SET utf8mb4
    SQL,
    <<<SQL
    CREATE TABLE IF NOT EXISTS race_tries (  -- recent race uploads, to limit them per IP
      ip        VARCHAR(45) NOT NULL,
      tried_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX (ip, tried_at)
    ) CHARACTER SET utf8mb4
    SQL,
    <<<SQL
    CREATE TABLE IF NOT EXISTS cards (  -- cards found for the collection in Questing, kept forever
      user_id    INT          NOT NULL,
      code       VARCHAR(191) NOT NULL,  -- e.g. f:trees:oak@2026, q:creatures:fox, h:12345:Brander Gardens@2026:gold, p:ca
      detail     VARCHAR(255) NULL,      -- what found it, e.g. the street or the quest
      earned_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, code)
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
    CREATE TABLE IF NOT EXISTS segments (  -- short stretches to time yourself on, see segments.js
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT          NOT NULL,
      name        VARCHAR(255) NOT NULL,
      distance_m  DOUBLE       NOT NULL DEFAULT 0,
      points      MEDIUMTEXT   NOT NULL,  -- JSON: [[lat, lon], ...]
      created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX (user_id)
    ) CHARACTER SET utf8mb4
    SQL,
    <<<SQL
    CREATE TABLE IF NOT EXISTS art_shapes (  -- your own GPS art shapes, traced from SVG files in the browser (art.js)
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT          NOT NULL,
      name        VARCHAR(255) NOT NULL,
      points      TEXT         NOT NULL,  -- JSON: [[x, y], ...], y up, in a unit box
      created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX (user_id)
    ) CHARACTER SET utf8mb4
    SQL,
    <<<SQL
    CREATE TABLE IF NOT EXISTS segment_efforts (  -- the times each activity took on a segment, worked out in the browser
      segment_id  INT  NOT NULL,
      track_id    INT  NOT NULL,
      efforts     TEXT NOT NULL,  -- JSON: [[start (Unix seconds), seconds], ...], [] if it didn't do the segment
      PRIMARY KEY (segment_id, track_id),
      INDEX (track_id)
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
      metrics     TEXT         NULL,     -- JSON from gpx_metrics(); NULL until worked out
      profile     MEDIUMTEXT   NULL,     -- JSON [[km, metres], ...] elevation profile, or null
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

// The site's name and its primary sport (see sport.js) are the sysop's to
// choose, in feets-config.php only, so they can't change by accident. A
// sport that isn't one of these stops everything, rather than quietly
// counting the wrong activities.
const SPORTS = ['run', 'walk', 'cycle'];
$config['sport'] = $config['sport'] ?? 'run';
$config['name'] = trim((string) ($config['name'] ?? '')) ?: 'feets dashboard';
if (!in_array($config['sport'], SPORTS, true)) {
    fail("feets-config.php: 'sport' must be one of " . implode(', ', SPORTS), 500);
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
        // ...and pace, time and elevation. Existing rows get them from backfill_metrics().
        if (!$pdo->query("SHOW COLUMNS FROM tracks LIKE 'metrics'")->fetch()) {
            $pdo->exec('ALTER TABLE tracks ADD COLUMN metrics TEXT NULL AFTER track_time,
                        ADD COLUMN profile MEDIUMTEXT NULL AFTER metrics');
        }
        // ...and distance goals.
        if (!$pdo->query("SHOW COLUMNS FROM users LIKE 'goals'")->fetch()) {
            $pdo->exec('ALTER TABLE users ADD COLUMN goals TEXT NULL AFTER data_owner');
        }
        // ...and a home for the map.
        if (!$pdo->query("SHOW COLUMNS FROM users LIKE 'home'")->fetch()) {
            $pdo->exec('ALTER TABLE users ADD COLUMN home TEXT NULL AFTER goals');
        }
        // ...and weekly quests.
        if (!$pdo->query("SHOW COLUMNS FROM users LIKE 'quests'")->fetch()) {
            $pdo->exec('ALTER TABLE users ADD COLUMN quests TEXT NULL AFTER goals');
        }
        // ...and finding areas for places you run.
        if (!$pdo->query("SHOW COLUMNS FROM users LIKE 'area_scan'")->fetch()) {
            $pdo->exec('ALTER TABLE users ADD COLUMN area_scan TEXT NULL AFTER home');
        }
        // ...and experience points.
        if (!$pdo->query("SHOW COLUMNS FROM users LIKE 'xp_since'")->fetch()) {
            $pdo->exec('ALTER TABLE users ADD COLUMN xp_since TIMESTAMP NULL AFTER quests');
        }
        // ...and cards only from here on. Cards found before then came from
        // every past activity: they're cleared, with the trophies for their
        // sets (and any XP those earned), so everyone starts the collection again.
        if (!$pdo->query("SHOW COLUMNS FROM users LIKE 'cards_since'")->fetch()) {
            $pdo->exec('ALTER TABLE users ADD COLUMN cards_since TIMESTAMP NULL AFTER xp_since');
            $pdo->exec('DELETE FROM cards');
            $pdo->exec("DELETE FROM achievements WHERE code LIKE 'cards:%'");
            $pdo->exec("DELETE FROM xp_events WHERE ref LIKE 'trophy:cards:%'");
        }
        // ...and cards found at most one a set per run (1.18.4): the cards found
        // by running so far are cleared once, with their sets' trophies, and
        // everyone's activities from the last two weeks find them again.
        // Cards from quests and bosses stay.
        if (!$pdo->query("SELECT 1 FROM settings WHERE name = 'cards_per_run'")->fetch()) {
            $pdo->exec("DELETE FROM cards WHERE code LIKE 'f:%' OR code LIKE 'h:%'");
            $sets = ['distance', 'month', 'clock', 'trees', 'birds', 'numbers', 'types', 'land'];
            $codes = implode(', ', array_map(fn($id) => "'cards:$id'", $sets));
            $pdo->exec("DELETE FROM achievements WHERE code LIKE 'cards:h%' OR code IN ($codes)");
            $refs = implode(', ', array_map(fn($id) => "'trophy:cards:$id'", $sets));
            $pdo->exec("DELETE FROM xp_events WHERE ref LIKE 'trophy:cards:h%' OR ref IN ($refs)");
            $pdo->exec('UPDATE users SET cards_since = NOW() - INTERVAL 14 DAY');
            $pdo->exec("INSERT INTO settings (name, value) VALUES ('cards_per_run', NOW())");
        }
        // ...and the one-time look back for past travels (1.19.1).
        if (!$pdo->query("SHOW COLUMNS FROM users LIKE 'cards_lookback'")->fetch()) {
            $pdo->exec('ALTER TABLE users ADD COLUMN cards_lookback TIMESTAMP NULL AFTER cards_since');
        }
        // ...and running cards found again each year (1.19.0): the ones found so
        // far become editions of the year they were found in.
        if (!$pdo->query("SELECT 1 FROM settings WHERE name = 'cards_yearly'")->fetch()) {
            $rows = $pdo->query("SELECT user_id, code, YEAR(earned_at) AS y FROM cards
                                 WHERE (code LIKE 'f:%' OR code LIKE 'h:%') AND code NOT LIKE '%@%'")->fetchAll();
            $rename = $pdo->prepare('UPDATE IGNORE cards SET code = ? WHERE user_id = ? AND code = ?');
            foreach ($rows as $r) {
                $code = $r['code'];
                $new = substr($code, -5) === ':gold' ? substr($code, 0, -5) . '@' . $r['y'] . ':gold' : $code . '@' . $r['y'];
                $rename->execute([$new, $r['user_id'], $code]);
            }
            $pdo->exec("INSERT INTO settings (name, value) VALUES ('cards_yearly', NOW())");
        }
        // ...and view links that expire.
        if (!$pdo->query("SHOW COLUMNS FROM view_links LIKE 'expires_at'")->fetch()) {
            $pdo->exec('ALTER TABLE view_links ADD COLUMN expires_at TIMESTAMP NULL AFTER created_at');
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
// club sees. An unknown, turned-off or expired code means nobody is logged in.
function view_link_user(string $code): ?array {
    if (!preg_match('/^[0-9a-f]{24}$/', $code)) {
        return null;
    }
    $stmt = db()->prepare(
        'SELECT v.label, v.owner, UNIX_TIMESTAMP(v.expires_at) AS expires FROM view_links v JOIN users u ON u.id = v.owner
         WHERE v.code = ? AND (v.expires_at IS NULL OR v.expires_at > NOW())'
    );
    $stmt->execute([$code]);
    $row = $stmt->fetch();
    return $row ? ['id' => 0, 'username' => $row['label'], 'is_admin' => false, 'read_only' => true,
                   'data_owner' => (int) $row['owner'], 'view_link' => true,
                   'expires_at' => $row['expires'] === null ? null : (int) $row['expires'] * 1000] : null;
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
    if ($json['viewLink']) {
        $json['expiresAt'] = $user['expires_at'];  // Unix ms, or null
    } else {
        // View-only accounts open on the home of the map they see.
        $home = db()->prepare('SELECT home FROM users WHERE id = ?');
        $home->execute([$json['readOnly'] ? $user['data_owner'] : $user['id']]);
        $json['home'] = json_decode((string) $home->fetchColumn(), true) ?: null;
        if (!$json['readOnly']) {
            $scan = area_scan_state((int) $user['id']);
            $json['autoAreas'] = empty($scan['off']);
            $json['autoAreasLast'] = $scan['result'] ?? null;  // {at (Unix ms), text}: how the last turn went
        }
    }
    return $json;
}

// Behind Cloudflare, REMOTE_ADDR is Cloudflare's; the visitor's is in its header.
function client_ip(): string {
    return substr((string) ($_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? ''), 0, 45);
}

// Counts a password try against the username and this IP, and refuses it if
// either has had too many lately. The try is saved before the password is
// checked, so requests sent all at once still see each other. '' for the
// setup password, which is only limited per IP, so someone guessing the
// admin's password can't also lock them out of recovering it. Returns the
// try's id, for login_passed().
function count_login_try(string $username): int {
    $pdo = db();
    $pdo->exec('DELETE FROM login_attempts WHERE tried_at < NOW() - INTERVAL 1 DAY');
    $name = mb_strtolower(mb_substr(trim($username), 0, 32));
    $ip = client_ip();
    $pdo->prepare('INSERT INTO login_attempts (username, ip) VALUES (?, ?)')->execute([$name, $ip]);
    $id = (int) $pdo->lastInsertId();
    $stmt = $pdo->prepare(
        'SELECT COALESCE(SUM(username = ? AND username <> \'\'), 0) AS by_name, COALESCE(SUM(ip = ?), 0) AS by_ip
         FROM login_attempts WHERE (username = ? OR ip = ?) AND tried_at > NOW() - INTERVAL ' . LOGIN_WINDOW . ' MINUTE'
    );
    $stmt->execute([$name, $ip, $name, $ip]);
    $tries = $stmt->fetch();
    if ($tries['by_name'] > LOGIN_MAX_PER_USER || $tries['by_ip'] > LOGIN_MAX_PER_IP) {
        fail('Too many tries. Wait ' . LOGIN_WINDOW . ' minutes and try again.', 429);
    }
    return $id;
}

// The password was right: forget this try, and the username's earlier ones.
function login_passed(int $tryId, string $username = ''): void {
    $name = mb_strtolower(trim($username));
    db()->prepare("DELETE FROM login_attempts WHERE id = ? OR (username = ? AND username <> '')")->execute([$tryId, $name]);
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
    global $config;
    $user = current_user();
    return ['user' => $user ? user_json($user) : null, 'needsSetup' => !$user && needs_setup(),
            'viewLinkOff' => !$user && isset($_GET['view']),
            'site' => ['name' => $config['name'], 'sport' => $config['sport']]];
}

// Creates the first (admin) account. Guarded by app_password from feets-config.php,
// and only works while there are no users at all.
function setup(array $b): array {
    global $config;
    if (!needs_setup()) {
        fail('Setup has already been done', 403);
    }
    $try = count_login_try('');
    if (!hash_equals(trim($config['app_password']), trim($b['setupPassword'] ?? ''))) {
        fail('Wrong setup password', 403);
    }
    login_passed($try);
    [$username, $password] = credentials($b);
    $user = create_user($username, $password, true);
    // Tracks uploaded before accounts existed belong to the first account.
    db()->prepare('UPDATE tracks SET user_id = ? WHERE user_id IS NULL')->execute([$user['id']]);
    start_session($user['id']);
    return user_json($user);
}

function login(array $b): array {
    $stmt = db()->prepare('SELECT ' . USER_COLUMNS . ', u.password_hash FROM users u WHERE u.username = ?');
    $try = count_login_try((string) ($b['username'] ?? ''));
    $stmt->execute([trim($b['username'] ?? '')]);
    $user = $stmt->fetch();
    if (!$user || !password_verify($b['password'] ?? '', $user['password_hash'])) {
        usleep(random_int(400000, 800000));  // slow down password guessing
        fail('Wrong username or password', 403);
    }
    login_passed($try, $user['username']);
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
    $stmt = db()->prepare('SELECT code, label, created_at AS createdAt, UNIX_TIMESTAMP(expires_at) AS expiresAt
                           FROM view_links WHERE owner = ? ORDER BY created_at DESC');
    $stmt->execute([$userId]);
    return array_map(function ($link) {
        $link['expiresAt'] = $link['expiresAt'] === null ? null : (int) $link['expiresAt'] * 1000;
        return $link;
    }, $stmt->fetchAll());
}

function create_view_link(array $user, array $b): array {
    $label = mb_substr(trim((string) ($b['label'] ?? '')), 0, 100);
    if ($label === '') {
        fail('Give the link a name, like who it is for', 400);
    }
    $days = $user['is_admin'] ? (int) ($b['days'] ?? 0) : VIEW_LINK_DAYS;
    if ($days < 0 || $days > 365) {
        fail('A link can last up to 365 days', 400);
    }
    $code = bin2hex(random_bytes(12));
    db()->prepare('INSERT INTO view_links (code, owner, label, expires_at)
                   VALUES (?, ?, ?, IF(? > 0, NOW() + INTERVAL ? DAY, NULL))')
        ->execute([$code, (int) $user['id'], $label, $days, $days]);
    return ['code' => $code, 'days' => $days];
}

// Only the link's owner can turn it off; anyone else's request changes nothing.
function delete_view_link(int $userId, array $b): array {
    db()->prepare('DELETE FROM view_links WHERE owner = ? AND code = ?')->execute([$userId, (string) ($b['code'] ?? '')]);
    return ['ok' => true];
}

// --- Admin: every account, view link and open invite ---
// Only the admin sees these. Deleting an account takes everything that is
// theirs with it (tracks, routes, areas, segments, shapes, trophies, Strava
// connection, view links, and any view-only accounts looking at their map).
// The admin's own account, and any other admin's, can't be deleted here.

function require_admin(array $user): void {
    if (!$user['is_admin']) {
        fail('Only the admin can do that', 403);
    }
}

function admin_overview(array $admin): array {
    require_admin($admin);
    $users = db()->query(
        'SELECT u.id, u.username, u.is_admin, u.read_only, o.username AS owner, u.created_at AS createdAt,
                (SELECT COUNT(*) FROM tracks t WHERE t.user_id = u.id) AS tracks,
                (SELECT MAX(s.expires_at) FROM sessions s WHERE s.user_id = u.id) > NOW() AS signedIn
         FROM users u LEFT JOIN users o ON o.id = u.data_owner
         ORDER BY u.is_admin DESC, u.read_only, u.username'
    )->fetchAll();
    $links = db()->query(
        'SELECT v.code, v.label, u.username AS owner, v.created_at AS createdAt, UNIX_TIMESTAMP(v.expires_at) AS expiresAt
         FROM view_links v LEFT JOIN users u ON u.id = v.owner ORDER BY v.created_at DESC'
    )->fetchAll();
    $invites = db()->query(
        'SELECT code, read_only, created_at AS createdAt FROM invites
         WHERE used_by IS NULL AND created_at > NOW() - INTERVAL ' . INVITE_DAYS . ' DAY ORDER BY created_at DESC'
    )->fetchAll();
    return [
        'users' => array_map(fn($u) => [
            'id' => (int) $u['id'],
            'username' => $u['username'],
            'kind' => $u['is_admin'] ? 'admin' : ($u['read_only'] ? 'viewer' : 'member'),
            'owner' => $u['owner'],
            'createdAt' => $u['createdAt'],
            'tracks' => (int) $u['tracks'],
            'signedIn' => (bool) $u['signedIn'],
            'self' => (int) $u['id'] === (int) $admin['id'],
        ], $users),
        'viewLinks' => array_map(fn($l) => [
            'code' => $l['code'],
            'label' => $l['label'],
            'owner' => $l['owner'],
            'createdAt' => $l['createdAt'],
            'expiresAt' => $l['expiresAt'] === null ? null : (int) $l['expiresAt'] * 1000,
        ], $links),
        'invites' => array_map(fn($i) => [
            'code' => $i['code'],
            'kind' => $i['read_only'] ? 'viewer' : 'member',
            'createdAt' => $i['createdAt'],
        ], $invites),
    ];
}

function admin_delete_user(array $admin, array $b): array {
    require_admin($admin);
    $id = (int) ($b['id'] ?? 0);
    $stmt = db()->prepare('SELECT id, is_admin FROM users WHERE id = ?');
    $stmt->execute([$id]);
    $target = $stmt->fetch();
    if (!$target) {
        fail('No such account', 404);
    }
    if ($target['is_admin']) {
        fail("An admin account can't be deleted here", 403);
    }
    $pdo = db();
    $pdo->beginTransaction();
    // Their view-only accounts go too.
    $viewers = $pdo->prepare('SELECT id FROM users WHERE data_owner = ?');
    $viewers->execute([$id]);
    foreach ([$id, ...array_map('intval', $viewers->fetchAll(PDO::FETCH_COLUMN))] as $uid) {
        $pdo->prepare('DELETE FROM segment_efforts WHERE track_id IN (SELECT id FROM tracks WHERE user_id = ?)
                       OR segment_id IN (SELECT id FROM segments WHERE user_id = ?)')->execute([$uid, $uid]);
        foreach (['tracks', 'segments', 'routes', 'areas', 'way_names', 'art_shapes', 'achievements', 'cards', 'xp_events', 'sessions',
                  'password_resets', 'strava_accounts', 'strava_states'] as $table) {
            $pdo->prepare("DELETE FROM $table WHERE user_id = ?")->execute([$uid]);
        }
        $pdo->prepare('DELETE FROM view_links WHERE owner = ?')->execute([$uid]);
        $pdo->prepare('DELETE FROM race_entries WHERE race_id IN (SELECT id FROM races WHERE owner = ?)')->execute([$uid]);
        $pdo->prepare('DELETE FROM races WHERE owner = ?')->execute([$uid]);
        $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$uid]);
    }
    $pdo->commit();
    return ['ok' => true];
}

// Logs an account out on every device, without deleting it.
function admin_sign_out_user(array $admin, array $b): array {
    require_admin($admin);
    db()->prepare('DELETE FROM sessions WHERE user_id = ?')->execute([(int) ($b['id'] ?? 0)]);
    return ['ok' => true];
}

function admin_delete_view_link(array $admin, array $b): array {
    require_admin($admin);
    db()->prepare('DELETE FROM view_links WHERE code = ?')->execute([(string) ($b['code'] ?? '')]);
    return ['ok' => true];
}

function admin_delete_invite(array $admin, array $b): array {
    require_admin($admin);
    db()->prepare('DELETE FROM invites WHERE code = ? AND used_by IS NULL')->execute([(string) ($b['code'] ?? '')]);
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
    $try = count_login_try($user['username']);
    $full = find_user($user['username']);
    if (!password_verify($b['current'] ?? '', $full['password_hash'])) {
        usleep(random_int(400000, 800000));
        fail('Your current password is wrong', 403);
    }
    login_passed($try, $user['username']);
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
    $try = count_login_try('');
    $user = find_user($b['username'] ?? '');
    if (!$user || !hash_equals(trim($config['app_password']), trim($b['setupPassword'] ?? ''))) {
        usleep(random_int(400000, 800000));
        fail('Wrong setup password or username', 403);
    }
    login_passed($try, $user['username']);
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

// --- Pace, time and elevation ---
// Worked out here from the stored GPX, not in the browser, so old tracks and
// Strava imports get the same numbers as new uploads. Times need a <time> on
// the points and the climb an <ele>; tracks without them get nulls.

const EFFORTS = [1000, 5000, 10000, 21097, 42195];  // metres: the best efforts kept per track
const MOVING_SPEED = 0.5;   // m/s: slower than this between two points counts as stopped
const GLITCH_SPEED = 50.0;  // m/s: a jump faster than this is a GPS glitch, not movement
const MIN_STEP = 5.0;       // metres: see gpx_metrics()
const CLIMB_STEP = 3.0;     // metres: rises smaller than this are GPS noise
const PROFILE_POINTS = 150;

function haversine(float $lat1, float $lon1, float $lat2, float $lon2): float {
    $dLat = deg2rad($lat2 - $lat1);
    $dLon = deg2rad($lon2 - $lon1);
    $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon / 2) ** 2;
    return 2 * 6371000 * asin(sqrt($a));
}

// The track points of a GPX, one at a time: [segment, lat, lon, ele|null,
// time|null, offset, length], segment counting up from 0 at each <trkseg>, and
// offset and length the <trkpt> element's place in the text. Matched one small
// piece at a time, so a long file needs little memory and doesn't hit PCRE's limits.
function gpx_points(string $gpx): Generator {
    $segment = 0;
    $offset = 0;
    while (preg_match('#<(/?trkseg)\b[^>]*>|<trkpt\b([^>]*?)(?:/>|>(.*?)</trkpt>)#s', $gpx, $m, PREG_OFFSET_CAPTURE, $offset)) {
        $offset = $m[0][1] + strlen($m[0][0]);
        if ($m[1][0] !== '') {  // a segment starts or ends
            $segment++;
            continue;
        }
        if (!preg_match('#\blat\s*=\s*["\']([-+\d.eE]+)#', $m[2][0], $lat)
            || !preg_match('#\blon\s*=\s*["\']([-+\d.eE]+)#', $m[2][0], $lon)) {
            continue;
        }
        $body = $m[3][0] ?? '';
        $ele = preg_match('#<ele>\s*([-+\d.eE]+)\s*</ele>#', $body, $e) ? (float) $e[1] : null;
        $time = preg_match('#<time>\s*([^<]+?)\s*</time>#', $body, $t) ? strtotime($t[1]) : false;
        yield [$segment, (float) $lat[1], (float) $lon[1], $ele, $time === false ? null : $time, $m[0][1], strlen($m[0][0])];
    }
}

// Returns [metrics, profile]. metrics: { moving, elapsed (seconds), climb
// (metres), efforts: { "5000": seconds, ... } }, null where the file has no
// data for it. Efforts are the fastest stretch of each EFFORTS distance, by
// the clock, like Strava's. profile: [[km, metres], ...] or null.
function gpx_metrics(string $gpx): array {
    // One line through every segment: the distance along it (gaps between
    // segments don't count), and the time and elevation at each point.
    // The line only moves on once a point is MIN_STEP from the last one it
    // moved to, so GPS jitter (standing still, or wobbling either side of the
    // path) doesn't add distance or moving time.
    $dist = $times = $eles = [];
    $total = $moving = 0.0;
    $anchor = null;  // [segment, lat, lon, ele, time]
    foreach (gpx_points($gpx) as $point) {
        [$segment, $lat, $lon, $ele, $time] = $point;
        if ($anchor && $anchor[0] === $segment) {
            $d = haversine($anchor[1], $anchor[2], $lat, $lon);
            $dt = $time !== null && $anchor[4] !== null ? $time - $anchor[4] : 0;
            if ($d >= MIN_STEP && !($dt > 0 && $d / $dt > GLITCH_SPEED)) {
                if ($dt > 0 && $d / $dt >= MOVING_SPEED) {
                    $moving += $dt;
                }
                $total += $d;
                $anchor = $point;
            }
        } else {
            $anchor = $point;
        }
        $dist[] = $total;
        $times[] = $time;
        $eles[] = $ele;
    }

    // Times: only if most points have one.
    $d = $t = [];
    foreach ($times as $k => $time) {
        if ($time !== null) {
            $d[] = $dist[$k];
            $t[] = $time;
        }
    }
    $timed = count($t) > 1 && count($t) >= count($times) / 2 && end($t) > $t[0];
    $efforts = [];
    if ($timed) {
        $n = count($d);
        foreach (EFFORTS as $target) {
            if (end($d) < $target) {
                break;
            }
            // For each end point, the start is where the line was $target metres earlier.
            $best = INF;
            $i = 0;
            for ($j = 1; $j < $n; $j++) {
                $start = $d[$j] - $target;
                if ($start < 0) {
                    continue;
                }
                while ($d[$i + 1] <= $start) {
                    $i++;
                }
                $span = $d[$i + 1] - $d[$i];
                $startTime = $t[$i] + ($span > 0 ? ($t[$i + 1] - $t[$i]) * ($start - $d[$i]) / $span : 0);
                $best = min($best, $t[$j] - $startTime);
            }
            if ($best > 0 && $best < INF) {
                $efforts[(string) $target] = (int) round($best);
            }
        }
    }

    // Elevation: only if most points have one. Smoothed over 5 points, then
    // only rises of CLIMB_STEP or more count towards the climb.
    $climb = $profile = null;
    $e = $ed = [];
    foreach ($eles as $k => $ele) {
        if ($ele !== null) {
            $e[] = $ele;
            $ed[] = $dist[$k];
        }
    }
    $n = count($e);
    if ($n > 1 && $n >= count($eles) / 2) {
        $smooth = [];
        for ($k = 0; $k < $n; $k++) {
            $lo = max(0, $k - 2);
            $hi = min($n - 1, $k + 2);
            $smooth[] = array_sum(array_slice($e, $lo, $hi - $lo + 1)) / ($hi - $lo + 1);
        }
        $climb = 0.0;
        $ref = $smooth[0];
        foreach ($smooth as $v) {
            if ($v - $ref >= CLIMB_STEP) {
                $climb += $v - $ref;
                $ref = $v;
            } elseif ($ref - $v >= CLIMB_STEP) {
                $ref = $v;
            }
        }
        $length = end($ed);
        if ($length > 0) {
            $profile = [];
            $k = 0;
            for ($s = 0; $s < PROFILE_POINTS; $s++) {
                $at = $length * $s / (PROFILE_POINTS - 1);
                while ($k < $n - 1 && $ed[$k + 1] <= $at) {
                    $k++;
                }
                $profile[] = [round($at / 1000, 3), round($smooth[$k], 1)];
            }
        }
    }

    return [[
        'moving' => $timed ? (int) round($moving) : null,
        'elapsed' => $timed ? (int) (end($t) - $t[0]) : null,
        'climb' => $climb === null ? null : (int) round($climb),
        'efforts' => (object) $efforts,
    ], $profile];
}

// Works out pace, time and elevation for tracks stored before feets kept
// them, a few seconds' worth per request: reading every GPX at once could run
// out of time or memory. Returns { metrics: { id: metrics }, remaining }.
function backfill_metrics(int $userId): array {
    @set_time_limit(60);
    $ids = db()->prepare('SELECT id FROM tracks WHERE user_id = ? AND metrics IS NULL ORDER BY id LIMIT 500');
    $ids->execute([$userId]);
    $select = db()->prepare('SELECT gpx FROM tracks WHERE id = ?');
    $update = db()->prepare('UPDATE tracks SET metrics = ?, profile = ? WHERE id = ?');
    $done = [];
    $until = microtime(true) + 8;
    foreach ($ids->fetchAll(PDO::FETCH_COLUMN) as $id) {
        if (microtime(true) > $until) {
            break;
        }
        $select->execute([$id]);
        [$metrics, $profile] = gpx_metrics((string) $select->fetchColumn());
        $update->execute([json_encode($metrics), $profile === null ? null : json_encode($profile), $id]);
        $done[$id] = $metrics;
    }
    $left = db()->prepare('SELECT COUNT(*) FROM tracks WHERE user_id = ? AND metrics IS NULL');
    $left->execute([$userId]);
    return ['metrics' => (object) $done, 'remaining' => (int) $left->fetchColumn()];
}

// A track's elevation profile, fetched when its popup opens: { profile: [[km, metres]] | null }.
function track_profile(int $userId, int $id): array {
    $stmt = db()->prepare('SELECT profile FROM tracks WHERE id = ? AND user_id = ?');
    $stmt->execute([$id, $userId]);
    $profile = $stmt->fetchColumn();
    return ['profile' => $profile ? json_decode($profile) : null];
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
        'addedAt' => isset($row['added_unix']) ? (int) $row['added_unix'] * 1000 : null,  // Unix ms; null where not asked for
        // null: not worked out yet (see backfill_metrics). Decoded as objects so {} stays {}.
        'metrics' => isset($row['metrics']) ? json_decode($row['metrics']) : null,
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
        'SELECT id, strava_id, name, sport, simplified, file_name, color, visible, distance_m, track_time, metrics, geometry,
                UNIX_TIMESTAMP(added_at) AS added_unix, IF(simplified, NULL, gpx) AS gpx
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

// Resolves to { id, metrics }.
function add_track(int $userId, array $t): array {
    [$metrics, $profile] = gpx_metrics((string) $t['gpx']);
    $sport = normalize_sport($t['sport'] ?? null);
    $stmt = db()->prepare(
        'INSERT INTO tracks (user_id, name, sport, simplified, file_name, color, visible, distance_m, track_time,
                             metrics, profile, geometry, gpx)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $userId,
        mb_substr($t['name'], 0, 255),
        $sport,
        mb_substr($t['fileName'], 0, 255),
        $t['color'],
        $t['visible'] ? 1 : 0,
        (float) $t['distance'],
        $t['time'] ?? null,
        json_encode($metrics),
        $profile === null ? null : json_encode($profile),
        simplify_geometry($t['segments'], $t['waypoints']),
        $t['gpx'],
    ]);
    // The sport as it's kept ("Run" for "running"), so the list shows it straight away.
    return ['id' => (int) db()->lastInsertId(), 'metrics' => $metrics, 'sport' => $sport];
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

// --- Removing stray points ---
// A GPS glitch can put a point kilometres off, drawing a wild line. The
// stored geometry is simplified, so the points come from the GPX itself.

function track_gpx(int $userId, int $id): array {
    $stmt = db()->prepare('SELECT * FROM tracks WHERE id = ? AND user_id = ?');
    $stmt->execute([$id, $userId]);
    $row = $stmt->fetch();
    if (!$row) {
        fail('Track not found', 404);
    }
    return $row;
}

// Segments renumbered 0, 1, 2... (gpx_points counts both ends of each <trkseg>).
function track_points(int $userId, int $id): array {
    $points = [];
    $segment = -1;
    $last = null;
    foreach (gpx_points(track_gpx($userId, $id)['gpx']) as [$seg, $lat, $lon, , $time]) {
        if ($seg !== $last) {
            $segment++;
            $last = $seg;
        }
        $points[] = [$lat, $lon, $segment, $time];
    }
    if (count($points) < 2) {
        fail("This track's file has no track points to edit", 400);
    }
    return ['points' => $points];
}

function edit_track(int $userId, int $id, array $b): array {
    $row = track_gpx($userId, $id);
    $remove = array_flip(array_map('intval', $b['remove'] ?? []));
    $cuts = $segments = [];
    $distance = 0.0;
    $last = null;  // [segment, lat, lon] of the last point kept
    foreach (gpx_points($row['gpx']) as $i => [$seg, $lat, $lon, , , $offset, $length]) {
        if (isset($remove[$i])) {
            $cuts[] = [$offset, $length];
            continue;
        }
        if ($last && $last[0] === $seg) {
            $distance += haversine($last[1], $last[2], $lat, $lon);
            $segments[count($segments) - 1][] = [$lat, $lon];
        } else {
            $segments[] = [[$lat, $lon]];
        }
        $last = [$seg, $lat, $lon];
    }
    $segments = array_values(array_filter($segments, fn($s) => count($s) > 1));
    if (!$segments) {
        fail('That would leave nothing of the track', 400);
    }
    $gpx = $row['gpx'];
    foreach (array_reverse($cuts) as [$offset, $length]) {
        $gpx = substr_replace($gpx, '', $offset, $length);
    }
    [$metrics, $profile] = gpx_metrics($gpx);
    $geometry = simplify_geometry($segments, json_decode($row['geometry'], true)['waypoints'] ?? []);
    db()->prepare('UPDATE tracks SET gpx = ?, geometry = ?, distance_m = ?, metrics = ?, profile = ?, simplified = 1 WHERE id = ?')
        ->execute([$gpx, $geometry, $distance, json_encode($metrics), $profile === null ? null : json_encode($profile), $id]);
    // Its segment times were worked out from the points it had; find them again.
    db()->prepare('DELETE FROM segment_efforts WHERE track_id = ?')->execute([$id]);
    return track_json(track_gpx($userId, $id));
}

// Deleting a track that isn't there (or isn't yours) changes nothing, and
// still answers ok, so deleting twice isn't an error.
function delete_track(int $userId, int $id): array {
    $stmt = db()->prepare('DELETE FROM tracks WHERE id = ? AND user_id = ?');
    $stmt->execute([$id, $userId]);
    if ($stmt->rowCount()) {
        db()->prepare('DELETE FROM segment_efforts WHERE track_id = ?')->execute([$id]);
        db()->prepare('DELETE FROM xp_events WHERE user_id = ? AND track_id = ?')->execute([$userId, $id]);
    }
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
    [$metrics, $profile] = gpx_metrics($gpx);
    $row['metrics'] = json_encode($metrics);
    try {
        db()->prepare(
            'INSERT INTO tracks (user_id, strava_id, name, sport, simplified, file_name, color, visible, distance_m, track_time,
                                 metrics, profile, geometry, gpx)
             VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([$userId, $activity['id'], $row['name'], $row['sport'], $row['file_name'], $row['color'], $row['visible'],
                    $row['distance_m'], $row['track_time'], $row['metrics'], $profile === null ? null : json_encode($profile),
                    $row['geometry'], $gpx]);
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

// Names and types changed on Strava since import: compares one page (up to
// 200, newest first) of the Strava activity list with the imported tracks.
// $before: a start time (epoch) to page on from, 0 for the newest. One Strava
// request, so it works without the webhook, which a firewall like Cloudflare
// can keep Strava from reaching. Returns { changed: [{ id, name, sport }],
// checked, next (the $before for the following page, or null at the end),
// rateLimited }.
function strava_refresh(int $userId, array $b): array {
    $account = strava_account($userId);
    $before = (int) ($b['before'] ?? 0);
    [$status, $list] = strava_api($account, '/athlete/activities', ['per_page' => 200] + ($before > 0 ? ['before' => $before] : []));
    if ($status === 429) {
        return ['changed' => [], 'checked' => 0, 'next' => $before ?: null, 'rateLimited' => true];
    }
    if ($status !== 200 || !is_array($list)) {
        throw new RuntimeException('Strava activity list failed: ' . ($list['message'] ?? "HTTP $status"));
    }
    $byId = [];
    foreach ($list as $activity) {
        $byId[(string) $activity['id']] = $activity;
    }
    $changed = [];
    if ($byId) {
        $marks = implode(',', array_fill(0, count($byId), '?'));
        $tracks = db()->prepare("SELECT id, strava_id, name, sport FROM tracks WHERE user_id = ? AND strava_id IN ($marks)");
        $tracks->execute(array_merge([$userId], array_keys($byId)));
        $update = db()->prepare('UPDATE tracks SET name = ?, sport = ? WHERE id = ?');
        foreach ($tracks->fetchAll() as $t) {
            $activity = $byId[(string) $t['strava_id']];
            $name = mb_substr(trim($activity['name'] ?? '') ?: 'Strava activity', 0, 255);
            $sport = strava_sport($activity);
            if ($name !== $t['name'] || $sport !== (string) $t['sport']) {
                $update->execute([$name, $sport, $t['id']]);
                $changed[] = ['id' => (int) $t['id'], 'name' => $name, 'sport' => $sport ?: null];
            }
        }
    }
    // Strava lists newest first; the next page is everything before this one's oldest.
    $oldest = $list ? min(array_map(fn($a) => strtotime($a['start_date']), $list)) : null;
    return ['changed' => $changed, 'checked' => count($list), 'next' => count($list) === 200 ? $oldest : null, 'rateLimited' => false];
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

// Your names for OSM ways that have none, kept by way id apart from the areas,
// so they apply in every area that has the way and survive a refresh.
function way_names(int $userId): object {
    $stmt = db()->prepare('SELECT way_id, name FROM way_names WHERE user_id = ?');
    $stmt->execute([$userId]);
    $names = [];
    foreach ($stmt->fetchAll() as $row) {
        $names[(int) $row['way_id']] = $row['name'];
    }
    return (object) $names;
}

function save_way_names(int $userId, array $b): object {
    $name = mb_substr(trim((string) ($b['name'] ?? '')), 0, 255);
    $ways = array_slice(array_unique(array_map('intval', (array) ($b['ways'] ?? []))), 0, 5000);
    $put = db()->prepare('INSERT INTO way_names (user_id, way_id, name) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)');
    $remove = db()->prepare('DELETE FROM way_names WHERE user_id = ? AND way_id = ?');
    foreach ($ways as $way) {
        if ($way <= 0) continue;
        $name === '' ? $remove->execute([$userId, $way]) : $put->execute([$userId, $way, $name]);
    }
    return way_names($userId);
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

// --- Goals ---
// Distance goals per week and per month, in km: { week, month }, null when not set.

function goals(int $userId): array {
    $stmt = db()->prepare('SELECT goals FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $goals = json_decode((string) $stmt->fetchColumn(), true) ?: [];
    return ['week' => $goals['week'] ?? null, 'month' => $goals['month'] ?? null];
}

function save_goals(int $userId, array $b): array {
    $clean = fn($v) => is_numeric($v) && $v > 0 ? min(round((float) $v, 1), 10000.0) : null;
    $goals = ['week' => $clean($b['week'] ?? null), 'month' => $clean($b['month'] ?? null)];
    db()->prepare('UPDATE users SET goals = ? WHERE id = ?')->execute([json_encode($goals), $userId]);
    return $goals;
}

// --- Segments ---
// A segment is a short stretch, cut from one of your activities, that you
// time yourself on. Finding the efforts on it is done in the browser (see
// segments.js); they're kept here so each activity is only checked once.

const SEGMENT_MAX_BYTES = 200000;

function segment_json(array $row, array $efforts): array {
    return ['id' => (int) $row['id'], 'name' => $row['name'], 'distance' => (float) $row['distance_m'],
            'points' => json_decode($row['points'], true), 'createdAt' => $row['created_at'], 'efforts' => (object) $efforts];
}

function segments(int $userId, ?int $onlyId = null): array {
    $stmt = db()->prepare('SELECT * FROM segments WHERE user_id = ?' . ($onlyId ? ' AND id = ?' : '') . ' ORDER BY name');
    $stmt->execute($onlyId ? [$userId, $onlyId] : [$userId]);
    $rows = $stmt->fetchAll();
    $efforts = [];
    if ($rows) {
        $ids = array_map(fn($r) => (int) $r['id'], $rows);
        $marks = implode(',', array_fill(0, count($ids), '?'));
        $e = db()->prepare("SELECT segment_id, track_id, efforts FROM segment_efforts WHERE segment_id IN ($marks)");
        $e->execute($ids);
        foreach ($e->fetchAll() as $r) {
            $efforts[(int) $r['segment_id']][(int) $r['track_id']] = json_decode($r['efforts'], true);
        }
    }
    return array_map(fn($r) => segment_json($r, $efforts[(int) $r['id']] ?? []), $rows);
}

function segment_name(array $b): string {
    $name = mb_substr(trim((string) ($b['name'] ?? '')), 0, 255);
    if ($name === '') {
        fail('Give the segment a name', 400);
    }
    return $name;
}

function save_segment(int $userId, array $b): array {
    $points = $b['points'] ?? null;
    if (!is_array($points) || count($points) < 2) {
        fail('A segment needs a start and an end', 400);
    }
    $json = json_encode(array_map(fn($p) => [round((float) $p[0], 6), round((float) $p[1], 6)], $points));
    if (strlen($json) > SEGMENT_MAX_BYTES) {
        fail('That segment is too long', 400);
    }
    db()->prepare('INSERT INTO segments (user_id, name, distance_m, points) VALUES (?, ?, ?, ?)')
        ->execute([$userId, segment_name($b), (float) ($b['distance'] ?? 0), $json]);
    return segments($userId, (int) db()->lastInsertId())[0];
}

function owns_segment(int $userId, int $id): void {
    $stmt = db()->prepare('SELECT id FROM segments WHERE id = ? AND user_id = ?');
    $stmt->execute([$id, $userId]);
    if (!$stmt->fetchColumn()) {
        fail('Segment not found', 404);
    }
}

function rename_segment(int $userId, int $id, array $b): array {
    owns_segment($userId, $id);
    db()->prepare('UPDATE segments SET name = ? WHERE id = ?')->execute([segment_name($b), $id]);
    return segments($userId, $id)[0];
}

function delete_segment(int $userId, int $id): array {
    owns_segment($userId, $id);
    db()->prepare('DELETE FROM segment_efforts WHERE segment_id = ?')->execute([$id]);
    db()->prepare('DELETE FROM segments WHERE id = ?')->execute([$id]);
    return ['ok' => true];
}

function save_segment_efforts(int $userId, int $id, array $b): array {
    owns_segment($userId, $id);
    $insert = db()->prepare('REPLACE INTO segment_efforts (segment_id, track_id, efforts) VALUES (?, ?, ?)');
    foreach ((array) ($b['efforts'] ?? []) as $trackId => $list) {
        $clean = array_map(fn($e) => [(int) $e[0], round((float) $e[1], 1)], array_filter((array) $list, 'is_array'));
        $insert->execute([$id, (int) $trackId, json_encode($clean)]);
    }
    return ['ok' => true];
}

// --- Weekly quests ---
// Made up in the browser each week from your coverage (see quests.js); kept
// here so every device shows the same ones. week: the Monday they start, as
// YYYY-MM-DD; done: the ids of those finished; completed: quests finished in
// all, ever.

const QUESTS_MAX_BYTES = 20000;

function quests(int $userId): array {
    $stmt = db()->prepare('SELECT quests FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $q = json_decode((string) $stmt->fetchColumn(), true) ?: [];
    return ['week' => $q['week'] ?? null, 'quests' => $q['quests'] ?? [], 'done' => $q['done'] ?? [], 'completed' => (int) ($q['completed'] ?? 0),
            'boss' => $q['boss'] ?? null, 'bossDone' => !empty($q['bossDone']),
            'shields' => $q['shields'] ?? ['held' => 0, 'used' => [], 'earned' => []],
            'expedition' => $q['expedition'] ?? null, 'expeditionAt' => (int) ($q['expeditionAt'] ?? 0),
            'expeditionLast' => $q['expeditionLast'] ?? null, 'expeditions' => (int) ($q['expeditions'] ?? 0)];
}

function save_quests(int $userId, array $b): array {
    $week = (string) ($b['week'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $week)) {
        fail('Quests need the week they start', 400);
    }
    $shields = (array) ($b['shields'] ?? []);
    $q = ['week' => $week, 'quests' => array_values((array) ($b['quests'] ?? [])),
          'done' => array_values(array_map('strval', (array) ($b['done'] ?? []))), 'completed' => max(0, (int) ($b['completed'] ?? 0)),
          'boss' => is_array($b['boss'] ?? null) ? $b['boss'] : null, 'bossDone' => !empty($b['bossDone']),
          'shields' => ['held' => max(0, min(2, (int) ($shields['held'] ?? 0))),
                        'used' => array_values(array_slice(array_map('strval', (array) ($shields['used'] ?? [])), -200)),
                        'earned' => array_values(array_slice(array_map('strval', (array) ($shields['earned'] ?? [])), -200))],
          'expedition' => is_array($b['expedition'] ?? null) ? $b['expedition'] : null,
          'expeditionAt' => max(0, (int) ($b['expeditionAt'] ?? 0)),
          'expeditionLast' => isset($b['expeditionLast']) ? mb_substr((string) $b['expeditionLast'], 0, 30) : null,
          'expeditions' => max(0, (int) ($b['expeditions'] ?? 0))];
    $json = json_encode($q);
    if (strlen($json) > QUESTS_MAX_BYTES) {
        fail('Too many quests', 400);
    }
    db()->prepare('UPDATE users SET quests = ? WHERE id = ?')->execute([$json, $userId]);
    return $q;
}

// --- Home ---
// Where the map opens, in place of zooming out to every track.

function save_home(int $userId, array $b): array {
    $lat = $b['lat'] ?? null;
    $lon = $b['lon'] ?? null;
    $zoom = $b['zoom'] ?? null;
    $home = null;
    if (is_numeric($lat) && is_numeric($lon) && is_numeric($zoom)
        && abs((float) $lat) <= 90 && abs((float) $lon) <= 180 && $zoom >= 0 && $zoom <= 19) {
        $home = ['lat' => round((float) $lat, 5), 'lon' => round((float) $lon, 5), 'zoom' => (int) round((float) $zoom)];
    } elseif ($b) {
        fail('That is not a place on the map', 400);
    }
    db()->prepare('UPDATE users SET home = ? WHERE id = ?')->execute([$home === null ? null : json_encode($home), $userId]);
    return ['home' => $home];
}

// --- Finding areas for places you run ---
// The browser looks through your runs for places with no area and adds one
// (OSM data is fetched from the browser, see osm.js). To go easy on
// OpenStreetMap, each account gets a turn at most every AREA_SCAN_HOURS,
// however many devices or tabs have feets open: the claim is made here.
// A new account (AREA_SCAN_NEW_HOURS old or less) with fewer than
// AREA_SCAN_NEW_AREAS areas gets one every AREA_SCAN_NEW_MINUTES instead,
// so its first maps arrive while its activities are still coming in.
// Places a turn found nothing for are skipped for AREA_SCAN_SKIP_DAYS, then
// tried again: OpenStreetMap gets new boundaries, and a busy server can
// answer oddly.

const AREA_SCAN_HOURS = 6;
const AREA_SCAN_NEW_HOURS = 2;
const AREA_SCAN_NEW_AREAS = 5;
const AREA_SCAN_NEW_MINUTES = 10;
const AREA_SCAN_SKIPS = 500;  // places kept on the don't-try-again list
const AREA_SCAN_SKIP_DAYS = 30;

// The skipped places as {cell key: Unix time skipped}, dropping old ones.
// The list used to be plain keys (state.skip); those count from now.
function area_scan_skipped(array $state): array {
    $skipped = $state['skipped'] ?? array_fill_keys($state['skip'] ?? [], time());
    return array_filter($skipped, fn($at) => $at > time() - AREA_SCAN_SKIP_DAYS * 86400);
}

function area_scan_state(int $userId): array {
    $stmt = db()->prepare('SELECT area_scan FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    return json_decode((string) $stmt->fetchColumn(), true) ?: [];
}

// { go, skip, again }: again is the seconds until the next turn while the
// account is new (for the browser to ask then), or null.
function area_scan_claim(int $userId): array {
    db()->beginTransaction();
    $stmt = db()->prepare(
        'SELECT area_scan, created_at > NOW() - INTERVAL ? HOUR AS new_account,
                (SELECT COUNT(*) FROM areas WHERE areas.user_id = users.id) AS areas
         FROM users WHERE id = ? FOR UPDATE'
    );
    $stmt->execute([AREA_SCAN_NEW_HOURS, $userId]);
    $row = $stmt->fetch();
    $state = json_decode((string) $row['area_scan'], true) ?: [];
    $eager = $row['new_account'] && (int) $row['areas'] < AREA_SCAN_NEW_AREAS;
    $gap = $eager ? AREA_SCAN_NEW_MINUTES * 60 : AREA_SCAN_HOURS * 3600;
    $go = empty($state['off']) && time() - (int) ($state['last'] ?? 0) >= $gap;
    if ($go) {
        $state['last'] = time();
        $state['skipped'] = area_scan_skipped($state);
        unset($state['skip']);
        db()->prepare('UPDATE users SET area_scan = ? WHERE id = ?')->execute([json_encode($state), $userId]);
    }
    db()->commit();
    return [
        'go' => $go,
        'skip' => $go ? array_map('strval', array_keys($state['skipped'])) : [],
        'again' => $eager ? max(60, (int) ($state['last'] ?? 0) + $gap - time()) : null,
    ];
}

// {on?, skip?, result?, retry?}: result is how a turn went, to show; retry
// gives a turn back that OpenStreetMap was too busy for, so the next comes in
// AREA_SCAN_RETRY_MINUTES instead of AREA_SCAN_HOURS.
const AREA_SCAN_RETRY_MINUTES = 60;

function area_scan_save(int $userId, array $b): array {
    $state = area_scan_state($userId);
    if (array_key_exists('on', $b)) {
        $state['off'] = !$b['on'];
    }
    if (isset($b['result'])) {
        $state['result'] = ['at' => time() * 1000, 'text' => mb_substr((string) $b['result'], 0, 200)];
    }
    if (!empty($b['retry'])) {
        $state['last'] = time() - AREA_SCAN_HOURS * 3600 + AREA_SCAN_RETRY_MINUTES * 60;
    }
    $skip = array_filter(array_map('strval', $b['skip'] ?? []), fn($k) => preg_match('/^-?\d+,-?\d+$/', $k));
    $skipped = area_scan_skipped($state) + array_fill_keys($skip, time());
    asort($skipped);
    $state['skipped'] = array_slice($skipped, -AREA_SCAN_SKIPS, null, true);
    unset($state['skip']);
    db()->prepare('UPDATE users SET area_scan = ? WHERE id = ?')->execute([json_encode($state), $userId]);
    return ['on' => empty($state['off'])];
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
// --- Experience points ---
// Worked out in the browser (xp.js), which says what earned them; this keeps
// the ledger, so each thing only ever counts once and every device shows the
// same total. XP is private and only motivational, so the points aren't
// checked beyond being sensible. Nothing before xp_since counts: that's what
// stops an import of years of old activities levelling someone up at once.

const XP_KINDS = ['activity', 'streets', 'best', 'segment', 'streak', 'quest', 'trophy'];
const XP_LOSSES = ['idle', 'missed'];  // these have points of 0 or less

// xp_since is set the first time this is asked: a day back from then, so a
// run from earlier that day, before feets was opened, still counts.
function xp(int $userId, array $added = []): array {
    db()->prepare('UPDATE users SET xp_since = NOW() - INTERVAL 1 DAY WHERE id = ? AND xp_since IS NULL')->execute([$userId]);
    $stmt = db()->prepare('SELECT UNIX_TIMESTAMP(xp_since) AS since,
                                  (SELECT COALESCE(SUM(points), 0) FROM xp_events WHERE user_id = u.id) AS total
                           FROM users u WHERE id = ?');
    $stmt->execute([$userId]);
    $row = $stmt->fetch();
    $recent = db()->prepare('SELECT kind, points, detail, earned_at AS earnedAt FROM xp_events
                             WHERE user_id = ? ORDER BY earned_at DESC, ref DESC LIMIT 15');
    $recent->execute([$userId]);
    $events = array_map(fn($e) => ['points' => (int) $e['points']] + $e, $recent->fetchAll());
    $refs = db()->prepare('SELECT ref, kind, points FROM xp_events WHERE user_id = ?');
    $refs->execute([$userId]);
    $all = $refs->fetchAll();
    $idle = [];  // ref -> points, for taking idle days back
    foreach ($all as $e) {
        if ($e['kind'] === 'idle') {
            $idle[$e['ref']] = (int) $e['points'];
        }
    }
    return ['since' => (int) $row['since'] * 1000, 'total' => (int) $row['total'], 'recent' => $events,
            'refs' => array_column($all, 'ref'), 'idle' => (object) $idle, 'added' => $added];
}

function add_xp(int $userId, array $b): array {
    $insert = db()->prepare('INSERT IGNORE INTO xp_events (user_id, ref, kind, track_id, points, detail) VALUES (?, ?, ?, ?, ?, ?)');
    $owns = db()->prepare('SELECT 1 FROM tracks WHERE id = ? AND user_id = ?');
    $added = [];
    foreach (array_slice((array) ($b['events'] ?? []), 0, 500) as $e) {
        $ref = mb_substr(trim((string) ($e['ref'] ?? '')), 0, 150);
        $kind = (string) ($e['kind'] ?? '');
        $points = (int) ($e['points'] ?? 0);
        $gain = in_array($kind, XP_KINDS, true) && $points >= 1 && $points <= 1000;
        $loss = in_array($kind, XP_LOSSES, true) && $points <= 0 && $points >= -1000;
        if ($ref === '' || (!$gain && !$loss)) {
            continue;
        }
        $track = isset($e['track']) ? (int) $e['track'] : null;
        if ($track !== null) {
            $owns->execute([$track, $userId]);
            if (!$owns->fetch()) {
                continue;  // deleted since, or not theirs
            }
        }
        $detail = isset($e['detail']) ? mb_substr((string) $e['detail'], 0, 255) : null;
        $insert->execute([$userId, $ref, $kind, $track, $points, $detail]);
        if ($insert->rowCount()) {
            $added[] = $ref;
        }
    }
    $retract = db()->prepare("DELETE FROM xp_events WHERE user_id = ? AND ref = ? AND kind = 'idle'");
    foreach (array_slice((array) ($b['retract'] ?? []), 0, 500) as $ref) {
        $retract->execute([$userId, (string) $ref]);
    }
    return xp($userId, $added);
}

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

// --- Cards ---
// Like achievements: found in the browser (cards.js), remembered here with
// the date each was first found. Like XP, only from here on: cards_since is
// set the first time they're asked for, a day back so that day's run counts,
// and only activities recorded after it find any (app.js checks).

function list_cards(int $userId): array {
    db()->prepare('UPDATE users SET cards_since = NOW() - INTERVAL 1 DAY WHERE id = ? AND cards_since IS NULL')->execute([$userId]);
    $user = db()->prepare('SELECT UNIX_TIMESTAMP(cards_since) AS since, cards_lookback IS NOT NULL AS lookedBack FROM users WHERE id = ?');
    $user->execute([$userId]);
    $row = $user->fetch();
    $stmt = db()->prepare('SELECT code, detail, earned_at AS earnedAt FROM cards WHERE user_id = ? ORDER BY earned_at, code');
    $stmt->execute([$userId]);
    return ['since' => (int) $row['since'] * 1000, 'lookedBack' => (bool) $row['lookedBack'], 'cards' => $stmt->fetchAll()];
}

// The one-time look back: Passport and Places from every past activity, the
// one exception to cards only counting from here on. Once it's done, it's done.
function cards_looked_back(int $userId): array {
    db()->prepare('UPDATE users SET cards_lookback = NOW() WHERE id = ? AND cards_lookback IS NULL')->execute([$userId]);
    return list_cards($userId);
}

function add_cards(int $userId, array $b): array {
    $insert = db()->prepare('INSERT IGNORE INTO cards (user_id, code, detail) VALUES (?, ?, ?)');
    foreach (array_slice($b['cards'] ?? [], 0, 500) as $c) {
        $code = mb_substr(trim((string) ($c['code'] ?? '')), 0, 191);
        if ($code === '') {
            continue;
        }
        $detail = isset($c['detail']) ? mb_substr((string) $c['detail'], 0, 255) : null;
        $insert->execute([$userId, $code, $detail]);
    }
    return list_cards($userId);
}

// --- Your own GPS art shapes ---
// Only the traced line is stored, never the SVG.

const ART_SHAPE_POINTS = 400;

function art_shapes(int $userId, ?int $onlyId = null): array {
    $stmt = db()->prepare('SELECT * FROM art_shapes WHERE user_id = ?' . ($onlyId ? ' AND id = ?' : '') . ' ORDER BY created_at, id');
    $stmt->execute($onlyId ? [$userId, $onlyId] : [$userId]);
    return array_map(fn($r) => [
        'id' => (int) $r['id'],
        'name' => $r['name'],
        'points' => json_decode($r['points'], true),
        'createdAt' => $r['created_at'],
    ], $stmt->fetchAll());
}

function save_art_shape(int $userId, array $b): array {
    $name = mb_substr(trim((string) ($b['name'] ?? '')), 0, 255);
    if ($name === '') {
        fail('Give the shape a name', 400);
    }
    $points = $b['points'] ?? null;
    if (!is_array($points) || count($points) < 3 || count($points) > ART_SHAPE_POINTS) {
        fail('A shape needs 3 to ' . ART_SHAPE_POINTS . ' points', 400);
    }
    $clean = [];
    foreach ($points as $p) {
        if (!is_array($p) || !is_numeric($p[0] ?? null) || !is_numeric($p[1] ?? null)) {
            fail('Each point of a shape is [x, y]', 400);
        }
        $clean[] = [round(max(-1, min(2, (float) $p[0])), 4), round(max(-1, min(2, (float) $p[1])), 4)];
    }
    db()->prepare('INSERT INTO art_shapes (user_id, name, points) VALUES (?, ?, ?)')
        ->execute([$userId, $name, json_encode($clean)]);
    return art_shapes($userId, (int) db()->lastInsertId())[0];
}

function delete_art_shape(int $userId, int $id): array {
    $stmt = db()->prepare('DELETE FROM art_shapes WHERE id = ? AND user_id = ?');
    $stmt->execute([$id, $userId]);
    if (!$stmt->rowCount()) {
        fail('Shape not found', 404);
    }
    return ['ok' => true];
}

// --- Virtual races ---
// A race is a course, copied from one of your saved routes, and a time
// window. Anyone with its link (race.html?code=CODE) sees the leaderboard and
// can enter by uploading an activity: the server finds the fastest time it
// went from the course's start to its finish, along the course, within the
// window (race_time). Only that time and the name they give are kept, never
// the activity.

const RACE_NEAR = 30.0;     // metres: passing this close to the start or finish counts
const RACE_STRAY = 40.0;    // metres: this far off the course still counts as on it
const RACE_ON_COURSE = 0.8; // share of the run, start to finish, that must be on the course
const RACE_COVER = 0.9;     // share of the course the run must go along: no short cuts
const RACE_LENGTH = [0.85, 1.4];  // the run's distance, start to finish, as a share of the course's
const RACE_STEP = 10.0;     // metres between the points lines are compared at
const RACE_MIN_M = 100.0;   // shorter courses aren't worth racing
const RACE_MAX_DAYS = 366;
const RACE_GRACE_DAYS = 2;  // uploads stay open this long after the end, for runs on the last day
const RACE_MAX_ENTRIES = 1000;
const RACE_GPX_MAX_BYTES = 20 * 1024 * 1024;
const RACE_TRIES_PER_IP = 30;  // uploads per IP within LOGIN_WINDOW minutes

// [lat, lon] points as metres [x, y] on a flat plane; fine at the scale of a course.
function race_xy(array $points, float $lat0): array {
    $ky = 111320.0;
    $kx = $ky * cos(deg2rad($lat0));
    return array_map(fn($p) => [(float) $p[1] * $kx, (float) $p[0] * $ky], $points);
}

function race_gap(array $a, array $b): float {
    return hypot($a[0] - $b[0], $a[1] - $b[1]);
}

function race_length(array $xy): float {
    $m = 0.0;
    for ($i = 1, $n = count($xy); $i < $n; $i++) {
        $m += race_gap($xy[$i - 1], $xy[$i]);
    }
    return $m;
}

// Points every RACE_STEP metres along a line.
function race_dense(array $xy): array {
    $out = [$xy[0]];
    for ($i = 1, $n = count($xy); $i < $n; $i++) {
        [$x1, $y1] = $xy[$i - 1];
        [$x2, $y2] = $xy[$i];
        $steps = (int) ceil(race_gap($xy[$i - 1], $xy[$i]) / RACE_STEP);
        for ($k = 1; $k <= $steps; $k++) {
            $out[] = [$x1 + ($x2 - $x1) * $k / $steps, $y1 + ($y2 - $y1) * $k / $steps];
        }
    }
    return $out;
}

// A line's dense points in a grid of RACE_STRAY squares, for race_share().
function race_grid(array $xy): array {
    $grid = [];
    foreach (race_dense($xy) as $p) {
        $grid[(int) floor($p[0] / RACE_STRAY) . ',' . (int) floor($p[1] / RACE_STRAY)][] = $p;
    }
    return $grid;
}

// The share of $points within RACE_STRAY of the line in $grid.
function race_share(array $points, array $grid): float {
    $near = 0;
    foreach ($points as $p) {
        $cx = (int) floor($p[0] / RACE_STRAY);
        $cy = (int) floor($p[1] / RACE_STRAY);
        for ($x = $cx - 1; $x <= $cx + 1; $x++) {
            for ($y = $cy - 1; $y <= $cy + 1; $y++) {
                foreach ($grid["$x,$y"] ?? [] as $q) {
                    if (race_gap($p, $q) <= RACE_STRAY) {
                        $near++;
                        continue 4;
                    }
                }
            }
        }
    }
    return $points ? $near / count($points) : 0.0;
}

// Where in a pass by a point (indices $from to $to of $p, all near it) to time
// from: the last moment near its closest (leaving the start), or the first
// (reaching the finish). Standing about at the start or finish doesn't count.
function race_mark(array $p, int $from, int $to, array $at, bool $last): int {
    $closest = INF;
    for ($k = $from; $k <= $to; $k++) {
        $closest = min($closest, race_gap($p[$k], $at));
    }
    $mark = $last ? $to : $from;
    for ($k = $from; $k <= $to; $k++) {
        $i = $last ? $to - ($k - $from) : $k;
        if (race_gap($p[$i], $at) <= $closest + 5) {
            return $i;
        }
    }
    return $mark;
}

// The fastest an activity went along a course, from its start to its finish,
// starting and finishing between $from and $to (Unix seconds). Like a
// segment's efforts (segments.js), but a course can finish where it starts.
// Returns ['start' => Unix seconds, 'seconds' => …], or ['why' => …], how far
// the best try got: no-times, no-start, no-finish, off-course or outside.
function race_time(array $course, string $gpx, int $from, int $to): array {
    $points = [];
    $times = [];
    foreach (gpx_points($gpx) as [, $lat, $lon, , $time]) {
        if ($time !== null) {
            $points[] = [$lat, $lon];
            $times[] = $time;
        }
    }
    if (count($points) < 2) {
        return ['why' => 'no-times'];
    }
    $p = race_xy($points, (float) $course[0][0]);
    $c = race_xy($course, (float) $course[0][0]);
    $start = $c[0];
    $end = $c[count($c) - 1];
    $length = race_length($c);
    $onCourse = race_grid($c);
    $along = race_dense($c);
    $n = count($p);
    $reasons = ['no-start', 'no-finish', 'off-course', 'outside'];
    $got = 0;  // index in $reasons of how far the best try got
    $best = null;
    $i = 0;
    while ($i < $n) {
        if (race_gap($p[$i], $start) > RACE_NEAR) {
            $i++;
            continue;
        }
        // A pass by the start...
        $zone = $i;
        while ($i + 1 < $n && race_gap($p[$i + 1], $start) <= RACE_NEAR) {
            $i++;
        }
        $a = race_mark($p, $zone, $i, $start, true);
        $i++;
        // ... then on to the finish, once it's gone about the course's length.
        $metres = 0.0;
        $b = -1;
        for ($j = $a + 1; $j < $n; $j++) {
            $metres += race_gap($p[$j - 1], $p[$j]);
            if ($metres > $length * RACE_LENGTH[1]) {
                break;
            }
            if ($metres >= $length * RACE_LENGTH[0] && race_gap($p[$j], $end) <= RACE_NEAR) {
                $last = $j;
                while ($last + 1 < $n && race_gap($p[$last + 1], $end) <= RACE_NEAR) {
                    $last++;
                }
                $b = race_mark($p, $j, $last, $end, false);
                break;
            }
        }
        if ($b < 0) {
            $got = max($got, 1);
            continue;
        }
        $path = array_slice($p, $a, $b - $a + 1);
        // Along the course (not a short cut), and the whole of it (not just its ends).
        if (race_share($path, $onCourse) < RACE_ON_COURSE || race_share($along, race_grid($path)) < RACE_COVER) {
            $got = max($got, 2);
            continue;
        }
        $i = max($i, $b + 1);  // a lap done: the next may start where this one finished
        if ($times[$a] < $from || $times[$b] > $to) {
            $got = 3;
            continue;
        }
        $seconds = $times[$b] - $times[$a];
        if ($seconds > 0 && (!$best || $seconds < $best['seconds'])) {
            $best = ['start' => $times[$a], 'seconds' => $seconds];
        }
    }
    return $best ?: ['why' => $reasons[$got]];
}

function race_json(array $row): array {
    return ['id' => (int) $row['id'], 'code' => $row['code'], 'name' => $row['name'], 'distance' => (float) $row['distance_m'],
            'startsAt' => (int) $row['starts_at'] * 1000, 'endsAt' => (int) $row['ends_at'] * 1000,
            'entries' => (int) ($row['entries'] ?? 0)];
}

function races(int $userId, ?int $onlyId = null): array {
    $stmt = db()->prepare('SELECT r.*, (SELECT COUNT(*) FROM race_entries e WHERE e.race_id = r.id) AS entries
                           FROM races r WHERE r.owner = ?' . ($onlyId ? ' AND r.id = ?' : '') . ' ORDER BY r.starts_at DESC, r.id DESC');
    $stmt->execute($onlyId ? [$userId, $onlyId] : [$userId]);
    return array_map('race_json', $stmt->fetchAll());
}

// A race's name and window from {name, startsAt, endsAt} (Unix ms), falling
// back to $old's for any not given.
function race_fields(array $b, array $old): array {
    $name = mb_substr(trim((string) ($b['name'] ?? $old['name'])), 0, 100);
    $starts = isset($b['startsAt']) ? (int) floor((float) $b['startsAt'] / 1000) : (int) $old['starts_at'];
    $ends = isset($b['endsAt']) ? (int) floor((float) $b['endsAt'] / 1000) : (int) $old['ends_at'];
    if ($name === '') {
        fail('Give the race a name', 400);
    }
    if ($ends <= $starts) {
        fail('The race has to end after it starts', 400);
    }
    if ($ends - $starts > RACE_MAX_DAYS * 86400) {
        fail('A race can last a year at most', 400);
    }
    return [$name, $starts, $ends];
}

function race_create(int $userId, array $b): array {
    $stmt = db()->prepare('SELECT name, data FROM routes WHERE id = ? AND user_id = ?');
    $stmt->execute([(int) ($b['routeId'] ?? 0), $userId]);
    $route = $stmt->fetch();
    if (!$route) {
        fail('Route not found', 404);
    }
    // The route's line, as routePoints() in app.js draws it.
    $data = json_decode($route['data'], true);
    $points = [];
    foreach ($data['legs'] ?: $data['waypoints'] as $k => $leg) {
        $leg = $data['legs'] ? $leg : [$leg];
        foreach ($leg as $n => $pt) {
            if ($data['legs'] && $k && !$n) continue;  // each leg starts where the last one ended
            $points[] = [(float) $pt[0], (float) $pt[1]];
        }
    }
    $distance = 0.0;
    for ($i = 1; $i < count($points); $i++) {
        $distance += haversine($points[$i - 1][0], $points[$i - 1][1], $points[$i][0], $points[$i][1]);
    }
    if ($distance < RACE_MIN_M) {
        fail('That route is too short to race on', 400);
    }
    [$name, $starts, $ends] = race_fields($b, ['name' => $route['name'], 'starts_at' => 0, 'ends_at' => 0]);
    if ($ends < time()) {
        fail('That race would be over already', 400);
    }
    db()->prepare('INSERT INTO races (code, owner, name, course, distance_m, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        ->execute([bin2hex(random_bytes(12)), $userId, $name, json_encode(simplify_line($points, 2.0)), round($distance, 1), $starts, $ends]);
    return races($userId, (int) db()->lastInsertId())[0];
}

function race_update(int $userId, int $id, array $b): array {
    $stmt = db()->prepare('SELECT * FROM races WHERE id = ? AND owner = ?');
    $stmt->execute([$id, $userId]);
    $race = $stmt->fetch();
    if (!$race) {
        fail('Race not found', 404);
    }
    [$name, $starts, $ends] = race_fields($b, $race);
    db()->prepare('UPDATE races SET name = ?, starts_at = ?, ends_at = ? WHERE id = ?')->execute([$name, $starts, $ends, $id]);
    return races($userId, $id)[0];
}

function race_delete(int $userId, int $id): array {
    $stmt = db()->prepare('DELETE FROM races WHERE id = ? AND owner = ?');
    $stmt->execute([$id, $userId]);
    if ($stmt->rowCount()) {
        db()->prepare('DELETE FROM race_entries WHERE race_id = ?')->execute([$id]);
    }
    return ['ok' => true];
}

function race_entry_delete(int $userId, array $b): array {
    db()->prepare('DELETE e FROM race_entries e JOIN races r ON r.id = e.race_id WHERE e.id = ? AND r.owner = ?')
        ->execute([(int) ($b['id'] ?? 0), $userId]);
    return ['ok' => true];
}

// The race with this link's code, and its host's username.
function race_row(string $code): array {
    $race = null;
    if (preg_match('/^[0-9a-f]{24}$/', $code)) {
        $stmt = db()->prepare('SELECT r.*, u.username FROM races r JOIN users u ON u.id = r.owner WHERE r.code = ?');
        $stmt->execute([$code]);
        $race = $stmt->fetch();
    }
    if (!$race) {
        fail('There is no race at this link. It may have been deleted.', 404);
    }
    return $race;
}

// What the race page shows. The entrant's key marks their own time; the
// host, logged in, can take times off (mine).
function race_info(string $code, string $entrant = ''): array {
    $race = race_row($code);
    $user = current_user();
    $stmt = db()->prepare('SELECT id, entrant, name, seconds, started_at FROM race_entries WHERE race_id = ? ORDER BY seconds, added_at');
    $stmt->execute([$race['id']]);
    $entries = array_map(fn($e) => ['id' => (int) $e['id'], 'name' => $e['name'], 'seconds' => (int) $e['seconds'],
                                    'startedAt' => (int) $e['started_at'] * 1000,
                                    'yours' => $entrant !== '' && hash_equals($e['entrant'], $entrant)], $stmt->fetchAll());
    return ['name' => $race['name'], 'host' => $race['username'], 'distance' => (float) $race['distance_m'],
            'course' => json_decode($race['course'], true),
            'startsAt' => (int) $race['starts_at'] * 1000, 'endsAt' => (int) $race['ends_at'] * 1000,
            'closesAt' => ((int) $race['ends_at'] + RACE_GRACE_DAYS * 86400) * 1000,
            'mine' => $user && empty($user['read_only']) && (int) $user['id'] === (int) $race['owner'],
            'entries' => $entries];
}

// Counts a race upload against this IP, and refuses it past RACE_TRIES_PER_IP.
function count_race_try(): void {
    $pdo = db();
    $pdo->exec('DELETE FROM race_tries WHERE tried_at < NOW() - INTERVAL 1 DAY');
    $pdo->prepare('INSERT INTO race_tries (ip) VALUES (?)')->execute([client_ip()]);
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM race_tries WHERE ip = ? AND tried_at > NOW() - INTERVAL ' . LOGIN_WINDOW . ' MINUTE');
    $stmt->execute([client_ip()]);
    if ((int) $stmt->fetchColumn() > RACE_TRIES_PER_IP) {
        fail('Too many uploads. Wait ' . LOGIN_WINDOW . ' minutes and try again.', 429);
    }
}

function race_enter(string $code, array $b): array {
    $race = race_row($code);
    $name = mb_substr(trim(preg_replace('/\s+/u', ' ', (string) ($b['name'] ?? ''))), 0, 60);
    $entrant = (string) ($b['entrant'] ?? '');
    $gpx = (string) ($b['gpx'] ?? '');
    if (time() < (int) $race['starts_at']) {
        fail("The race hasn't started yet", 400);
    }
    if (time() > (int) $race['ends_at'] + RACE_GRACE_DAYS * 86400) {
        fail('This race is over: uploads have closed', 400);
    }
    if ($name === '') {
        fail('Type your name for the leaderboard', 400);
    }
    if (!preg_match('/^[0-9a-f]{32}$/', $entrant)) {
        fail('Missing entrant key', 400);
    }
    if ($gpx === '' || strlen($gpx) > RACE_GPX_MAX_BYTES) {
        fail('Upload a GPX, FIT or TCX file of up to ' . (RACE_GPX_MAX_BYTES >> 20) . ' MB', 400);
    }
    count_race_try();
    $stmt = db()->prepare('SELECT seconds FROM race_entries WHERE race_id = ? AND entrant = ?');
    $stmt->execute([$race['id'], $entrant]);
    $before = $stmt->fetchColumn();
    if ($before === false) {
        $count = db()->prepare('SELECT COUNT(*) FROM race_entries WHERE race_id = ?');
        $count->execute([$race['id']]);
        if ((int) $count->fetchColumn() >= RACE_MAX_ENTRIES) {
            fail('This race is full', 400);
        }
    }
    $time = race_time(json_decode($race['course'], true), $gpx, (int) $race['starts_at'], (int) $race['ends_at']);
    if (isset($time['why'])) {
        return ['counted' => false, 'why' => $time['why'], 'race' => race_info($code, $entrant)];
    }
    $best = $before === false || $time['seconds'] < (int) $before;
    if ($best) {
        db()->prepare('INSERT INTO race_entries (race_id, entrant, name, seconds, started_at) VALUES (?, ?, ?, ?, ?)
                       ON DUPLICATE KEY UPDATE name = VALUES(name), seconds = VALUES(seconds),
                       started_at = VALUES(started_at), added_at = CURRENT_TIMESTAMP')
            ->execute([$race['id'], $entrant, $name, $time['seconds'], $time['start']]);
    } else {
        db()->prepare('UPDATE race_entries SET name = ? WHERE race_id = ? AND entrant = ?')->execute([$name, $race['id'], $entrant]);
    }
    return ['counted' => true, 'seconds' => $time['seconds'], 'startedAt' => $time['start'] * 1000, 'best' => $best,
            'race' => race_info($code, $entrant)];
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
} elseif ($method === 'GET' && $action === 'race') {
    send_json(race_info((string) ($_GET['code'] ?? ''), (string) ($_GET['entrant'] ?? '')));
} elseif ($method === 'POST' && $action === 'race_enter') {
    send_json(race_enter((string) ($_GET['code'] ?? ''), read_json()));
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
    $readable = !empty($user['view_link']) ? ['routes'] : ['', 'areas', 'way_names', 'achievements', 'routes', 'goals', 'track_profile', 'art_shapes'];
    if ($method !== 'GET' || !in_array($action, $readable, true) || isset($_GET['gpx'])) {
        fail('This is a view-only account', 403);
    }
}

if ($method === 'POST' && $action === 'invite') {
    send_json(create_invite($user));
} elseif ($method === 'GET' && $action === 'view_links') {
    send_json(list_view_links($userId));
} elseif ($method === 'POST' && $action === 'view_link_create') {
    send_json(create_view_link($user, read_json()));
} elseif ($method === 'POST' && $action === 'view_link_delete') {
    send_json(delete_view_link($userId, read_json()));
} elseif ($method === 'POST' && $action === 'change_password') {
    send_json(change_password($user, read_json()));
} elseif ($method === 'POST' && $action === 'reset_link') {
    send_json(create_reset_link($user, read_json()));
} elseif ($method === 'GET' && $action === 'admin_overview') {
    send_json(admin_overview($user));
} elseif ($method === 'POST' && $action === 'admin_user_delete') {
    send_json(admin_delete_user($user, read_json()));
} elseif ($method === 'POST' && $action === 'admin_user_sign_out') {
    send_json(admin_sign_out_user($user, read_json()));
} elseif ($method === 'POST' && $action === 'admin_view_link_delete') {
    send_json(admin_delete_view_link($user, read_json()));
} elseif ($method === 'POST' && $action === 'admin_invite_delete') {
    send_json(admin_delete_invite($user, read_json()));
} elseif ($method === 'GET' && $action === 'strava_status') {
    send_json(strava_status($userId));
} elseif ($method === 'GET' && $action === 'strava_connect') {
    strava_connect($userId);
} elseif ($method === 'POST' && $action === 'strava_sync') {
    send_json(strava_sync($userId));
} elseif ($method === 'POST' && $action === 'strava_refresh') {
    send_json(strava_refresh($userId, read_json()));
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
} elseif ($method === 'GET' && $action === 'races') {
    send_json(races($userId));
} elseif ($method === 'POST' && $action === 'race_create') {
    send_json(race_create($userId, read_json()));
} elseif ($method === 'POST' && $action === 'race_update' && $id) {
    send_json(race_update($userId, $id, read_json()));
} elseif ($method === 'POST' && $action === 'race_delete' && $id) {
    send_json(race_delete($userId, $id));
} elseif ($method === 'POST' && $action === 'race_entry_delete') {
    send_json(race_entry_delete($userId, read_json()));
} elseif ($method === 'GET' && $action === 'way_names') {
    send_json(way_names($userId));
} elseif ($method === 'POST' && $action === 'way_names_save') {
    send_json(save_way_names($userId, read_json()));
} elseif ($method === 'GET' && $action === 'routes') {
    send_routes($userId);
} elseif ($method === 'POST' && $action === 'route_save') {
    route_save($userId, read_json());
} elseif ($method === 'POST' && $action === 'route_rename' && $id) {
    route_rename($userId, $id, read_json());
} elseif ($method === 'POST' && $action === 'route_delete' && $id) {
    send_json(route_delete($userId, $id));
} elseif ($method === 'GET' && $action === 'goals') {
    send_json(goals($userId));
} elseif ($method === 'POST' && $action === 'goals_save') {
    send_json(save_goals($userId, read_json()));
} elseif ($method === 'GET' && $action === 'segments') {
    send_json(segments($userId));
} elseif ($method === 'POST' && $action === 'segment_save') {
    send_json(save_segment($userId, read_json()));
} elseif ($method === 'POST' && $action === 'segment_rename' && $id) {
    send_json(rename_segment($userId, $id, read_json()));
} elseif ($method === 'POST' && $action === 'segment_delete' && $id) {
    send_json(delete_segment($userId, $id));
} elseif ($method === 'GET' && $action === 'art_shapes') {
    send_json(art_shapes($userId));
} elseif ($method === 'POST' && $action === 'art_shape_save') {
    send_json(save_art_shape($userId, read_json()));
} elseif ($method === 'POST' && $action === 'art_shape_delete' && $id) {
    send_json(delete_art_shape($userId, $id));
} elseif ($method === 'POST' && $action === 'segment_efforts' && $id) {
    send_json(save_segment_efforts($userId, $id, read_json()));
} elseif ($method === 'GET' && $action === 'quests') {
    send_json(quests($userId));
} elseif ($method === 'POST' && $action === 'quests_save') {
    send_json(save_quests($userId, read_json()));
} elseif ($method === 'POST' && $action === 'home_save') {
    send_json(save_home($userId, read_json()));
} elseif ($method === 'POST' && $action === 'area_scan_claim') {
    send_json(area_scan_claim($userId));
} elseif ($method === 'POST' && $action === 'area_scan_save') {
    send_json(area_scan_save($userId, read_json()));
} elseif ($method === 'POST' && $action === 'track_metrics') {
    send_json(backfill_metrics($userId));
} elseif ($method === 'GET' && $action === 'track_profile' && $id) {
    send_json(track_profile($userId, $id));
} elseif ($method === 'GET' && $action === 'track_points' && $id) {
    send_json(track_points($userId, $id));
} elseif ($method === 'POST' && $action === 'track_edit' && $id) {
    send_json(edit_track($userId, $id, read_json()));
} elseif ($method === 'GET' && $action === 'achievements') {
    send_json(list_achievements($userId));
} elseif ($method === 'POST' && $action === 'achievement_add') {
    send_json(add_achievements($userId, read_json()));
} elseif ($method === 'GET' && $action === 'cards') {
    send_json(list_cards($userId));
} elseif ($method === 'POST' && $action === 'card_add') {
    send_json(add_cards($userId, read_json()));
} elseif ($method === 'POST' && $action === 'cards_looked_back') {
    send_json(cards_looked_back($userId));
} elseif ($method === 'GET' && $action === 'xp') {
    send_json(xp($userId));
} elseif ($method === 'POST' && $action === 'xp_add') {
    send_json(add_xp($userId, read_json()));
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
