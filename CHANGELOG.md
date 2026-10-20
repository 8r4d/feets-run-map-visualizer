# Changelog

feets uses [semantic versioning](https://semver.org/): MAJOR.MINOR.PATCH.
A new feature bumps MINOR, a fix bumps PATCH, and a change that breaks
existing data or setups bumps MAJOR. The version shows in the sidebar's
About box (`public/index.html`); keep it and this file in step.

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
