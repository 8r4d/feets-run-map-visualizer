# Changelog

feets uses [semantic versioning](https://semver.org/): MAJOR.MINOR.PATCH.
A new feature bumps MINOR, a fix bumps PATCH, and a change that breaks
existing data or setups bumps MAJOR. The version shows in the sidebar's
About box (`public/index.html`); keep it and this file in step.

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
