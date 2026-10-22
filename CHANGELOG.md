# Changelog

feets uses [semantic versioning](https://semver.org/): MAJOR.MINOR.PATCH.
A new feature bumps MINOR, a fix bumps PATCH, and a change that breaks
existing data or setups bumps MAJOR. The version shows in the sidebar's
About box (`public/index.html`); keep it and this file in step.

## 1.25.0 — 2026-10-21

- The race page has a "Where do I find my run's file?" box under the entry
  form. It opens to say how to export a run from Garmin, Strava, COROS,
  Polar, Suunto and Apple Watch, how to pick the file on a phone, and what
  to do when it doesn't count (a .zip, a route with no times, missing the
  start or finish). It opens by itself when a run doesn't count.

## 1.24.1 — 2026-10-21

- The planning bar under the map is tidier: three columns instead of four.
  The route's name, distance, elevation chart (now wider) and the street
  coverage tick sit together on the left, with no gaps between them; all
  the buttons are in the middle; saved routes on the right show more before
  scrolling.

## 1.24.0 — 2026-10-21

- Secret holiday palettes. With "seasonal" picked, the colours change for a
  few days around New Year (30 Dec–2 Jan), Valentine's Day (12–14 Feb),
  St Patrick's Day (15–17 Mar), Easter (Good Friday–Easter Monday),
  Canada Day (29 Jun–2 Jul), Halloween (27–31 Oct) and Christmas
  (20–26 Dec), with a small mark after the title. They aren't in the
  picker. The season's palette comes back after.

## 1.23.0 — 2026-10-21

- Planned routes show distance markers: a small numbered badge at each km
  (or mile), every 2, 5, 10... when zoomed out so they don't crowd. They show
  in shared (public) routes too. None at the finish.

## 1.22.1 — 2026-10-21

- Neon: buttons with no colour of their own were left in the browser's grey,
  which looked brown against the cyan. They're now cyan on navy, lighting up
  when hovered.

## 1.22.0 — 2026-10-21

- Colour palettes, picked beside the title: classic (as before), spring,
  summer, autumn and winter, or seasonal, which follows the season by month
  (northern hemisphere) and turns over by itself. Each season works in light
  and dark, so the toggle still does. Neon is a Tron-style dark palette, cyan
  lines glowing on near-black; with it the light/dark toggle hides. The
  phone's bar above the page and the virtual race page match the palette.

## 1.21.0 — 2026-10-21

- Two new settings in `feets-config.php`, for whoever runs the site: `name`
  (the sidebar title, `feets dashboard` by default) and `sport`, the primary
  sport (`run`, `walk` or `cycle`, `run` by default). The sport decides which
  activities count for trophies, quests, cards, streaks, XP, the fog and the
  stats, and what distances they aim for: on a cycling site rides count and
  targets run longer (100 km long bosses, a Century trophy, a speed in place
  of a pace). Running sites work exactly as before. Any other sport stops
  the site with an error saying so.

## 1.20.3 — 2026-10-20

- Your streak is a card too, under a small "This week" heading with the
  week's quests: this week's new street towards keeping it going (green once
  the week counts), your best streak and your shields.

## 1.20.2 — 2026-10-20

- The box with the boss, the expedition and the week's quests is now called
  Quests (it was This week), and its count says "0 of 3 this week".

## 1.20.1 — 2026-10-20

- The week's quests look like the boss and the expedition: a card each, with
  an icon for its kind, a progress bar and what it's worth (a card from the
  set of the moment and 50 XP), turning green when done. Daybreak's colour
  is now sunrise pink, so it doesn't look like a weekly quest.

## 1.20.0 — 2026-10-20

- Expeditions, under the month's boss: a longer quest with no deadline, in a
  theme with its own cards. Night Sky (get out after dark, by the sun where
  you ran), Daybreak (around sunrise), Wild Trails, Cartographer (streets
  you've never run), Voyage (distance), Peaks (climbing) and Garden (days out).
  Finishing one turns over a card from its theme and earns 50 XP, and the next
  starts straight away; *Give up* brings a new one a day later. Night Sky
  cards now come from expeditions instead of the weekly quests.

## 1.19.1 — 2026-10-20

- *Look back for past travels*, once: a button under the Travels sets adds
  Passport stamps and Places from all your past activities, the one exception
  to cards only counting from here on. If OpenStreetMap gets busy partway,
  what's found is kept and you can finish it later.
- Fixed: when OpenStreetMap was busy, runs after that point in a check lost
  their places even when they were already known.

## 1.19.0 — 2026-10-20

- Cards are now a collection that keeps growing for years. Every running set,
  and each area's neighbourhoods, has a new edition every year: on 1 January
  they start again, last year's cards stay (shown faded until found again),
  and a card found in several years shows how many. A finished set's trophy
  is for its year. The card count is now everything found, all time.
- New sets: Passport (a stamp with its flag for every country you run in)
  and Places (every town or city), which never finish; Globetrotter (how far
  from home, each half of the world, the tropics and the Arctic); and Up and
  Over (climbs of 50 to 500 m in a run).
- On a trip, times of day are the trip's own: a run's time moves an hour for
  every 15° of longitude from home.
- Cards found so far become editions of 2026.

## 1.18.4 — 2026-10-20

- A run finds at most one card in each running set (and each area's
  neighbourhoods): of the ones it could find, one at random, the same on every
  device. The rest wait for another run that does it too. A neighbourhood
  turns gold on a run after its card.
- The cards found by running so far, and the trophies for those sets, are
  cleared once more, and activities from the last two weeks find them again
  under the new rule. Cards from quests and bosses stay.

## 1.18.3 — 2026-10-20

- The seasons follow a Canadian prairie year: March is Sugar Shack (still
  winter, but maple syrup time), Spring Thaw moves to April, and November is
  Freeze-Up (first snow, toques and hockey) in place of Falling Leaves. The
  Twelve Months cards for March, April and November match.

## 1.18.2 — 2026-10-20

- Fixed: *Add street maps where I've been* stopped finding the neighbourhoods
  next to ones you already have. It judged each ~1 km square by the first
  point of a run in it, so a square on the edge of a mapped area was taken as
  mapped whenever that point fell inside. A run now counts in a square when
  any of its points there are outside every area, and that point is what's
  looked up.
- A turn OpenStreetMap was too busy for is tried again an hour later instead
  of 12, and under the checkbox it now says when it last looked and what it
  found.

## 1.18.1 — 2026-10-20

- A long-run boss is never more than a half marathon (it was up to a
  marathon), and this month's comes down to that if it was set higher.

## 1.18.0 — 2026-10-20

- A boss every month, above the week's quests in Questing: one bigger
  challenge (a long run past your longest of late, a lot of new streets in one
  neighbourhood, or new streets anywhere), counting only from when it appears.
  Beating it earns 200 XP and the month's legend card: twelve legends, one a
  month, back the next year if missed.
- A season for every month: each month's quests turn over cards from its own
  set of 8 (New Year, Hearts, Sugar Shack… Freeze-Up, Winter), back every
  year.
- Streak shields: finish every quest in a week to earn one (hold up to 2). A
  week without new streets uses one up and your streak carries on, streak
  trophies included.

## 1.17.1 — 2026-10-20

- Cards only count from here on, like XP: only activities recorded since
  cards started, and added within a week of being recorded, find them, and
  neighbourhood cards count only the streets those activities covered. Cards
  already found from older activities, and the trophies for their sets, are
  cleared once, so everyone starts the collection fresh.

## 1.17.0 — 2026-10-20

- Cards, in Questing: sets to collect, kept for good, with a trophy for each
  set finished. Quest sets: every weekly quest you finish turns over a card you
  don't have yet (Trail Creatures, Night Sky and Any Weather, plus Halloween in
  October and Winter in December, back every year). Running sets: distances,
  months, times of day, and street names (trees, birds, numbers, street types,
  hills and lakes…). And a set per area of its neighbourhoods, each card turning
  gold when every street in it is done. See Help → Getting Started, "Cards".

## 1.16.0 — 2026-10-20

- Virtual races: choose *Race* on a saved route in Planning, give the race a
  name and its first and last days, and send the link. Anyone with it can open
  the race's page (no account needed), see the course and the leaderboard, and
  enter by uploading a run of it. The server times each run from the course's
  start to its finish, wherever the runner started their watch, as long as it
  follows the course (no short cuts) and was run during the race. Each runner
  keeps their best time, uploads stay open 2 days after the end, and only names
  and times are kept, never the runs. Your races are listed under Account, and
  opening a race's page while logged in lets you take times off. See Help →
  Guest Sharing, "Virtual races".

## 1.15.0 — 2026-10-20

- feets in Japanese (日本語): pick it from the language menu, or it's used by
  itself when your browser is set to Japanese. The help pages stay in English,
  as they do in French and Chinese.

## 1.14.0 — 2026-10-20

- Name the paths, trails and roads OpenStreetMap has no name for: click one
  in Road Fill and choose *Name it*. The name is used like any street's: in
  the to-do list, on the map, in street quests and in the street counts for
  trophies, in every area that has it, and it stays when an area is
  refreshed. Pieces of one path given the same name count as one street (the
  dialog offers names you've used already). *Rename* renames every piece with
  that name, and *Remove the name* takes it off. Names OSM already has can't
  be changed. Names are your own; view-only accounts see the owner's.

## 1.13.0 — 2026-10-19

- Each map mode keeps its own base map: pick the topographic map in Questing
  and the dark one in Tracks, say, and each mode goes back to its own. The
  heatmap still starts on the dark map, the others on the street map.
- In Questing, the layers button's menu opens over the level and quests
  column instead of under it.

## 1.12.0 — 2026-10-19

- The map modes have clearer names: Tracks, Heatmap, Questing (was Fog),
  Road Fill (was Streets) and Planning (was Plan). On a phone they're
  shortened (Tracks, Heat, Quest, Roads, Plan) to fit beside the layers button.
- Questing mode is the game side of feets: your level, this week's quests and
  your trophies have moved there from the sidebar, into a column on the right
  of the map (on a phone, the panel under it), over the fog of war. XP notes
  still pop up in every mode.
- XP can slip a little: a quest not done by the end of its week costs 20, and
  after 7 days without an activity each day costs a bit more than the last
  (5, 10, 15… up to 50 a day). Losses never take you below the start of your
  level, so you can't lose a level, and your next activity starts the week
  again.

## 1.11.0 — 2026-10-19

- Levels and experience points (XP), at the top of the panel. Private, and
  only from here on: XP starts counting today (from a day back, so today's
  run counts), and only activities recorded since then, and added within a
  week of being recorded, earn any, so importing old activities doesn't level
  you up. XP comes from each activity (more for longer ones, less per extra
  km), new streets, new bests over 1K to a marathon, segment bests, streak
  weeks, quests and trophies. Deleting an activity takes away what it earned.
  See Help → Getting Started, "Levels and XP".

## 1.10.0 — 2026-10-19

- feets can be installed as an app: on an iPhone with Share → Add to Home
  Screen, and on Android or in Chrome and Edge with "Install feets as an app"
  in the About box. It opens in its own window, with its own icon (two
  footprints), and opens without a connection too, though your tracks need
  one to load. Nothing of yours is kept on the device for that, only the page.
- The phone's bar above the page follows light and dark mode.
- For developers: tests. `tests/run.sh` runs them against a throwaway database
  and server (see README, "Tests").

## 1.9.0 — 2026-10-19

- Add FIT and TCX files as well as GPX: FIT is what Garmin, Coros, Wahoo and
  Suunto watches record, TCX is Garmin's older format. Gzipped files work too,
  so the activities in a Strava "Download your data" archive can go in at
  once. They're turned into GPX as they're added, and kept and downloaded as
  GPX, with their times and heights, so pace and climb work as before.
- A new track shows its activity type tidied up ("Run", not "running") straight
  away, instead of after a reload.

## 1.8.0 — 2026-10-19

- Miles: pick Kilometres or Miles under Account (next to Language) or on the
  login screen. Distances, paces (/mi), speeds (mph), climbs and heights (ft),
  the map's scale, goals, and the lengths typed in Plan mode all follow it.
  feets starts in miles for a browser set to US English. Goals are kept in km,
  so switching doesn't change them. Trophies keep the names they were earned
  with ("100 km").

## 1.7.1 — 2026-10-19

- Password guessing is stopped properly. Within 15 minutes a username gets 5
  tries and an IP address 20, after which even the right password waits out
  the 15 minutes. Before, each wrong password only cost a second, and many
  sent at once weren't slowed at all. "Forgot password?" with the setup
  password is limited per IP only, so it still unlocks a guessed-at account.
- Deleting a track only clears that track's segment times if it was yours.
  Before, asking to delete someone else's track (which was refused) still
  cleared its segment times.

## 1.7.0 — 2026-10-19

- Sharing: view links and route links last 7 days for everyone but the admin,
  so they're no longer asked how long. The server holds them to it. The admin
  still picks the days, or keeps a link working until it's turned off. Links
  made before this keep the expiry they were given.

## 1.6.0 — 2026-10-19

- Dark mode: the ☾ button beside the title turns the page dark, and ☀ turns
  it light again. Until you press it, feets follows your system's setting.
  Your choice is remembered in this browser. The map itself stays as picked
  under the layers button; choose "Dark" there for a dark map too.

## 1.5.2 — 2026-10-19

- Quests: a "Finish …" quest whose street you've since marked off-limits is
  swapped for another street to finish (or dropped if there's none), instead
  of hanging about all week. New quests already left off-limits streets out.

## 1.5.1 — 2026-10-18

- Marking streets off-limits is quick, even a few dozen in a row (all the
  paths in a zoo, say): each one greys out at once, and they're saved together
  once you pause, with one request per area instead of one per street per
  area. The totals, lists and trophies catch up after the pause too.

## 1.5.0 — 2026-10-18

- Streets: tick neighbourhoods under "By neighbourhood" to count only those.
  The coverage bars and "Still to cover" list then cover just the ticked ones,
  and the streets outside them are dimmed on the map. Each area remembers its
  ticks; "Count all" clears them.
- Plan: "Stay in" can keep a loop inside several neighbourhoods. Pick the area,
  then tick its neighbourhoods under it. Ticking none keeps the whole area.
- Plan: "Stay in" can also keep a loop inside several areas, e.g. two
  districts: pick "several areas…" and tick them. A loop stays inside the one
  it starts in when they don't touch. GPS art still picks one area or
  neighbourhood.
- Streets: "several areas…" in the area menu colours in the streets of every
  area ticked, for an overview of a large patch at once. It shows no totals,
  neighbourhoods or "Still to cover" list; pick a single area for those.

## 1.4.0 — 2026-10-18

- Admin: "All accounts and links" in Account lists every account (admin,
  members, viewers), every view link and every unused invite. The admin can
  reset passwords, log an account out everywhere, delete viewers and members
  (a member's tracks, routes, areas and the rest go with them, after typing
  their username), turn off anyone's view link and cancel invites.
- Your view links in Account wrap onto more lines instead of pushing the Copy
  link and Turn off buttons out of sight.

## 1.3.0 — 2026-10-18

- A welcome card for new accounts: until the first track arrives, the sidebar
  shows Connect with Strava / Upload GPX buttons, a link to Getting Started and
  a language picker, with Add tracks opened and the boxes that would only be
  empty (trophies, stats, goals, filters, the track list) hidden.

## 1.2.0 — 2026-10-18

- French (Français), translated as far as the Chinese: the sidebar, map
  controls, buttons, menus and login screen. Pick it under Language, or it's
  chosen for you when your browser prefers French over English.

## 1.1.0 — 2026-10-18

- Simplified Chinese (中文). feets picks it when your browser prefers Chinese,
  and there's a Language picker in Account and on the login screen. The
  sidebar, map controls, buttons, menus and login screen are translated;
  messages, stats, trophies, quests and the help pages are still English.
- Translations live in `public/lang/` (see `public/i18n.js` for how to add
  phrases or another language).

## 1.0.0 — 2026-10-18

The first numbered version. Everything feets does so far, including:

- Tracks from GPX files and Strava (with automatic import), on an
  OpenStreetMap map, with filters, stats, goals, weekly quests, trophies and
  segments.
- Map modes: tracks, heatmap, fog of war (with fog that grows back, and small
  patches of fog shut in by clearings cleared too), street coverage and route
  planning.
- Street maps for the places you run, found and added in the background, and
  sooner for new accounts in their first couple of hours.
- Route planning with loops, ghost races, and GPS art: built-in shapes, your
  own shapes from SVG files, and a Loose ↔ Strict setting for how closely the
  route follows the shape.
- Accounts, invitations, view-only accounts and view links.
