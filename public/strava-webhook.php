<?php
// Strava's webhook calls this URL (registered by the "Automatic import" switch).
// It has its own file because Strava adds its own query parameters to the URL.
$_GET['action'] = 'strava_webhook';
require __DIR__ . '/api.php';
