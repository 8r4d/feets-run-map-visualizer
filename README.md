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

## Sharing without an account

**Share view link**, under **Account**, makes a link that shows your saved
routes to anyone who has it, with no login: for a running club, say.
- **What they see:** a plain map and the list of your saved routes, with the
  newest one open. They can switch between routes and download each as GPX.
  Nothing else: no tracks, heatmap, street areas, trophies or route editing.
  The server sends a view link nothing but the routes.
- **One route:** in **Plan**, click **Link** next to a saved route to get a
  link that opens straight to that route. It uses your newest view link, or
  offers to make one.
- **Turning it off:** each link is listed under **Account** with **Turn off**.
  Anyone using it then sees the login screen.
- The link holds the access, so anyone it's forwarded to can use it too.
- To show someone your whole map instead, use **Invite viewer**.

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
- **Still to run:** the list of unfinished streets starts with the nearest to
  the middle of the map. Tap ⌖ on the map to show where you are, and while that
  dot is in view the list starts from you instead, with how far away each is.
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
| `public/planner.js`  | Routes planned routes along the areas' streets.          |
| `public/stats.js`    | The Stats box's sums, and progress towards goals.        |
| `public/achievements.js` | Which trophies are earned.                           |
| `public/elevation.js`| Elevation charts, and planned routes' elevation from Open-Meteo. |
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

## Planning routes

**Plan** mode draws routes along the streets of your areas, with no outside
routing service.

1. Switch to **Plan**. The active area's streets are coloured as in Streets
   mode, so you can aim for the red ones. Untick **Show street coverage** for
   a plain map; routes still follow the streets.
2. Click the map to add points. Each one is routed along the streets from the
   last. Drag a point to move it, click it to remove it. **Back to start**
   closes the loop.
3. The panel shows the distance, the climb, and how much of it is on streets
   you haven't run yet (counting the tracks on the map, as in Streets mode),
   with an elevation chart below.
4. **Save** keeps the route under a name (a route you opened is saved over);
   **Download GPX** gives a file for a watch, or to import into Strava as a
   route. Saved routes can be renamed from the list.

**Fill with unrun streets** makes the route for you: set a length and press it
for a loop over as many streets you haven't run as fit.
- **Where it starts:** the route's first point if you've placed one, else
  where you are if the ⌖ dot is in view, else the middle of the map.
- **How:** from where it is, it heads for the stretch of unrun street that
  gives the most new street per metre of running (long streets are taken up
  to 400 m at a time), as long as it can still get home in time; then the
  next, until nothing more fits. Getting between them, it prefers streets you
  haven't run and avoids ones it already used. It tries a few ways and keeps
  the one with the most new street.
- **"Unrun"** means not covered by the tracks on the map, as in Streets mode,
  and leaves out streets marked unrunnable.
- The loop is never longer than the length you set, and is often a little
  shorter. The result is an ordinary route: drag or remove points, then save
  or download it.

Things to know:
- Routes only follow streets in areas you've added, and skip streets marked
  unrunnable. Click within 150 m of a street.
- Crossings and sidewalks aren't in the street data, so a street's loose end is
  joined to any other street within 15 m. If two points still can't be
  joined, that part is drawn as a dashed straight line.
- View-only accounts can open saved routes and plan their own, but can't save.
- **Elevation** comes from [Open-Meteo](https://open-meteo.com/en/docs/elevation-api)'s
  free elevation API, a ~90 m terrain model: the browser sends it points along
  the route, so it learns where the route goes. A saved route keeps its
  elevation, so opening one doesn't ask again. Fine for hills, too coarse to
  see a bridge or an underpass.

## Stats

The **Stats** box sums up the tracks matching the filters, so pick a year in
the filters for a time frame (and a type, e.g. Run, to leave out rides):
distance, number of activities and active days, average per activity and per
week, the longest activity, the longest and current streak of days in a row,
the best week (Monday to Sunday) and month, and distance by type.

At the top, a calendar shades each day by distance: the filters' year, or else
the last 12 months. Hover or tap a day to see what you did; click one to zoom
the map to it.

From each track's GPX it also adds moving time, average pace on foot, total
climb, and the fastest 1K, 5K, 10K, half and marathon on foot. Hiding tracks
with their checkboxes doesn't change the stats.

## Pace, time and elevation

`api.php` works these out from each track's GPX when it's added, Strava
imports included. Click a track on the map, or its name in the list, for its
moving and elapsed time, pace (speed for rides), climb, best efforts and an
elevation chart.

- **Older tracks** get them in the background the first time you open feets
  after updating; the track list counts down while it works. View-only accounts
  see them once the owner has opened feets.
- **Moving time** leaves out stops: the time between points where you moved
  slower than 0.5 m/s. GPS wobble under 5 m doesn't count as moving.
- **Best efforts** are the fastest stretch of each distance within a run, by
  the clock, like Strava's.
- **Climb** adds up rises of 3 m or more, after smoothing, so GPS noise doesn't
  add up. Expect it to differ a little from Strava's or your watch's.
- A GPX with no times or elevations (one drawn by hand, say) has none of these.

## Goals

The **Goals** box tracks a distance to cover each week (Monday to Sunday) and/or
each month. Click **Set goals** to choose them; they're saved with your account.

- **Which tracks count:** runs, trail runs, walks, hikes and tracks with no
  type, as for trophies. The filters don't change it.
- It shows how far you are this week or month, what's left, and the days
  remaining, plus a bar for each of the last 8, green where you met the goal.
- Reaching a goal while feets is open pops up a note.

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
