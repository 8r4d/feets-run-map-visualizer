# feets

A small personal web app for viewing GPX tracks on an OpenStreetMap map.
Tracks are stored in MySQL through a single PHP file, `api.php`. Each person
logs in with their own account and sees only their own tracks. New accounts are
created by invitation.

## Deploy to your web host

1. Upload `feets-config.php` **one folder above** your website's public folder,
   if your host lets you. If it doesn't, put it inside the public folder next to
   `api.php`. That's still safe: the web server runs `.php` files instead of
   sending their contents.
2. Upload everything in `public/` into your website folder, or into a subfolder
   such as `feets/`. Every URL is relative, so a subfolder works fine.
3. Open the site. On the very first visit it asks for the `app_password` from
   `feets-config.php`. Enter it, then choose your own username and password.
   That account becomes the admin, and any tracks already in the database are
   assigned to it.

The database tables are created automatically on the first request.

## Inviting people

Open **Account & admin** and click **Invite member** (only the admin sees it) to get a link. Each link works once,
within 7 days. The person opens it, chooses a username and password, and gets
their own empty track list.

**Invite viewer**, in the same box, makes a view-only link instead, for showing feets to someone:
- **What they see:** your tracks, heatmap and street areas.
- **What they can do:** pan, zoom, switch modes and use the filters. Showing or
  hiding tracks only affects their own browser.
- **What they can't do:** upload, import from Strava, download, edit, delete,
  add areas or change any setting, including their own password. The server
  refuses those requests, not just the page.

When you change any JS or CSS file, raise the `?v=` number on its link in
`index.html`. Otherwise the host may keep serving the old file.

## Street coverage

**Streets** mode shows how much of an area's roads, paths and trails your
tracks cover, for "run every street" projects.

1. Switch to **Streets** and zoom the map to the neighbourhood.
2. Click **Add area** and pick one. Areas come from OpenStreetMap's boundaries.
   In Edmonton, for example, Riverbend is a district and Brander Gardens is a
   neighbourhood inside it. feets fetches the area's streets, which takes from
   a few seconds to a minute.
3. Streets turn green when done, orange when started and red when not run
   yet. Trails are dashed.
4. The panel shows:
   - progress for roads, paths and trails, overall and per neighbourhood,
   - a list of unfinished streets, nearest to the middle of the map first.
     Click one to see it.

Things to know:
- **Which tracks count:** only the tracks on the map. Use the filters, for
  example type = Run, to count only some of them.
- **What counts as a street:**
  - Public roads, footpaths, multi-use paths and trails count.
  - Motorways, alleys, driveways, parking aisles, crossings and private ways
    don't.
  - Neither do sidewalks mapped as separate lines: running the road covers them.
- **When a street counts as run:** a point on a street is visited when a track
  passed within 20 m, going the same way. Crossing a street doesn't count. A
  street is done when 90% of its points are visited.
- **Nearest street wins:** where a path runs right beside a road, only the
  nearest one gets credit.
- **Unrunnable streets:** click a street on the map and choose **Mark
  unrunnable**, or click **Skip** in the to-do list. Use this for a busy road
  with no sidewalk, for example.
  - A named street is marked throughout the area; an unnamed path or trail
    only where you clicked.
  - Marked streets turn grey and dotted, and don't count in the totals or the
    to-do list.
  - They can't take credit from a path running beside them either.
  - Undo it with **Count again** in the "Unrunnable streets" list.
  - Marks are kept when you refresh the area.
  - Motorways and trunk roads (like the Anthony Henday) never count anyway.
- **New streets:** OpenStreetMap changes over time. **Refresh from
  OpenStreetMap** fetches the area again.
- **Where the data comes from:** the browser fetches the data itself, from
  Nominatim (the boundary) and Overpass (the streets). Shared hosting may not
  let PHP wait long enough for Overpass when it's busy, so the server only
  stores the result.

## Passwords

feets doesn't send email, so password resets go through the admin:
- **Change password:** anyone logged in opens **Account**, clicks **Change password**, then enters their
  current password and a new one.
- **Reset someone's password:** the admin clicks **Reset a password** and enters a
  username. That creates a link which works once, within 48 hours. Send it
  to the person, and they choose a new password from it.
- **Admin locked out:** on the login screen, click **Forgot password?** and
  enter the `app_password` from `feets-config.php`, a username and a new
  password. That works for any account.

Every change or reset logs that account out on its other devices.

## Strava import (optional)

Each user can connect their own Strava account and import their activities.
Garmin devices can sync to Strava automatically, so this also brings in Garmin
activities.

1. Go to https://www.strava.com/settings/api and create an API application.
   Strava requires the app owner to have a paid subscription.
2. Set **Authorization Callback Domain** to your site's domain, for example
   `feets.example.com`, with no `https://` and no path.
3. Copy the **Client ID** and **Client Secret** into the `strava` section of
   `feets-config.php`, then upload that file again.
4. In feets, click **Connect with Strava** and approve access. The import
   starts by itself.
5. Optional, admin only: under the Strava buttons, click **Turn on** next to
   "Automatic import is off". From then on, Strava tells feets about new,
   edited and deleted activities as they happen, for every connected user.

How it keeps up to date:
- **Page load:** each time someone opens feets, it continues any unfinished
  import and fetches activities added since their last visit.
- **Rate limit:** if the import hits Strava's limit, the page waits for the
  next 15-minute window and carries on by itself while the tab is open.
- **Automatic import:** this uses Strava's webhook, which calls
  `strava-webhook.php`. Strava doesn't sign these calls, so feets checks each
  one with Strava before importing, renaming or deleting anything.
- **If the host can't keep working after replying:** some hosts stop PHP as soon
  as it has replied to Strava. In that case events are stored and handled the
  next time the athlete opens feets.

How the import works:
- **What's imported:** every activity that has GPS. Treadmill runs and manual
  entries are skipped. Each activity is saved with a GPX file built from
  Strava's GPS data, so ↓ download works.
- **Where it resumes:** feets remembers the newest activity it has looked at.
  Each import continues from there, so a track you delete isn't imported again.
- **Rate limit:** Strava allows about 200 requests every 15 minutes, and each
  activity takes one. If a large first import hits the limit, feets stops and
  asks you to click Import again later.
- **Number of people:** Strava's default "single player" mode allows only your
  own account. To let invited users connect theirs too, use Strava's
  self-service upgrade, which allows up to 10 athletes.
- **Disconnecting** cancels feets' access on Strava and keeps the tracks
  already imported. Strava's login tokens are stored in the
  `strava_accounts` table.

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
- **Filters:** search by name, pick a year or an activity type, or combine them.
  - Filters decide what appears in the list and on the map, in both Tracks and Heatmap mode.
  - **Show all** and **Hide all** apply to whatever currently matches.
  - The list shows the newest 100 matches. Click **Show more** for the next 100.

Routes are stored simplified, to about 3 metres, so that thousands of tracks
load quickly. The original GPX is kept for the ↓ download.

## Files

| File                 | Purpose                                                  |
|----------------------|----------------------------------------------------------|
| `feets-config.php`   | Database credentials, the setup/recovery password, and Strava app keys. Ignored by git. |
| `feets-config.example.php` | The same file with placeholders, kept in git. Copy it to `feets-config.php` to set up a new install. |
| `public/api.php`     | Accounts, logins, invites, tracks and Strava import, all in MySQL. It's the only backend code. |
| `public/index.html`  | Page layout. Loads Leaflet from a CDN.                   |
| `public/app.js`      | Map setup, track list UI, file upload handling, login form. |
| `public/gpx.js`      | Parses GPX tracks, routes and waypoints in the browser, and works out distance. |
| `public/store.js`    | Calls `api.php`.                                         |
| `public/osm.js`      | Fetches an area's boundary and streets from OpenStreetMap and prepares them. |
| `public/coverage.js` | Works out which streets the tracks cover.                |
| `public/strava-webhook.php` | Address Strava's webhook calls. Passes them on to `api.php`. |
| `public/style.css`   | Styles.                                                  |

## Notes

- **Logins.**
  - Passwords are stored as hashes made with PHP's `password_hash`.
  - A login lasts 30 days. It's kept in the `sessions` table, and the browser holds
    it in an HttpOnly cookie the page's JavaScript can't read.
  - A wrong password costs about half a second, which slows down guessing. There's
    no lockout, so use real passwords.
- **Use HTTPS.** Open the site over `https://` so passwords are encrypted on their
  way to the server.
- **Large files.** Uploads larger than PHP's `post_max_size` (often 8 MB on shared
  hosting) or MySQL's `max_allowed_packet` will fail.

## Trophies

The **Trophies** box collects milestones as you go: an area at 25, 50 and 75%,
an area or neighbourhood complete, kilometres of unique streets covered,
neighbourhoods finished, total distance, and your first 10K, half marathon and
marathon.

- **Which tracks count:** every run, trail run, walk and hike, plus tracks with
  no type. The filters and checkboxes don't matter here, so hiding tracks
  can't lose or earn a trophy.
- **When they're checked:** when feets opens, and after you add tracks or
  areas or mark streets unrunnable. Tracks Strava imports on its own are
  checked the next time someone opens feets.
- **They're kept:** once earned, a trophy stays, even if a refreshed area adds
  new streets and your coverage drops.
- **Yearly trophies:** from 2026 on, each calendar year has its own set,
  counting only that year's tracks: distance, km of unique streets,
  neighbourhoods finished, and longest run. A neighbourhood counts for a year
  when every street is run again within it. Earlier years don't get these. The box lists
  this year's trophies first, then all-time ones; past years' are kept but
  not shown.
- View-only accounts see the owner's trophies.
