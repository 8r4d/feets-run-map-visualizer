<?php
// feets configuration: an example with placeholders, safe to keep in git.
// Copy it to feets-config.php and fill in real values. That copy holds your
// passwords, so it stays out of git (see .gitignore).
//
// On your host, put feets-config.php ONE FOLDER ABOVE your website folder if you can
// (so it can't be reached from the web at all). If not, put it next to api.php.
// It is still safe there, because the web server runs .php files instead of showing them.

return [
    // Setup password: creates the first (admin) account on the very first visit,
    // and later unlocks "Forgot password?" on the login screen, which can reset
    // any account. Make it long and random, and don't reuse it anywhere.
    'app_password' => 'change-me-to-something-long-and-random',

    'mysql' => [
        'host'     => 'your-mysql-host.example.com',
        'port'     => 3306,
        'user'     => 'your-database-user',
        'password' => 'your-database-password',
        'database' => 'your-database-name',
    ],

    // Strava import (optional). Create an app at https://www.strava.com/settings/api
    // and set its "Authorization Callback Domain" to your site's domain (no https://).
    // Leave these empty to hide the Strava buttons.
    'strava' => [
        'client_id'     => '',
        'client_secret' => '',
    ],
];
