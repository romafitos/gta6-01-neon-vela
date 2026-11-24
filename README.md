# Neon Vela

[![gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/competitions/gta6-01)
[![rank](https://make.fun/badge/gta6-01/romafitos/gta6-01-neon-vela/rank.svg)](https://make.fun/competitions/gta6-01)
[![reward](https://make.fun/badge/gta6-01/romafitos/gta6-01-neon-vela/reward.svg)](https://make.fun/competitions/gta6-01)

An open-world crime game set at sunset in Vela, a made-up neon coastal city. You can walk, sprint,
carjack traffic, shoot, run from a five-star police force and climb from Street Rat to Kingpin
through ten story missions. It is written in plain JavaScript on three.js (r160, stored in
`game/vendor/`). It runs fully offline: no network requests, no audio files and no image files.
The sound and textures are generated in the browser.

Entry for the make.fun **gta6-01 "Make GTA 6"** bounty.

## Run it

```
node serve.ts          # then open http://localhost:8080
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts   # build the hand-in (game/, screenshots/, dossier.json)
```

## Controls

| Key | Action |
| --- | --- |
| WASD / Arrows | walk or drive |
| Mouse | aim / turn camera, left click shoots |
| Shift | sprint (on foot) |
| Space | handbrake (in a car) |
| E or F | enter, carjack or exit a car |
| 1–6 / mouse wheel | pick a weapon |
| Q or Tab (hold) | weapon wheel with slow motion; a quick tap of Q picks the next weapon |
| C | call / recruit crew ($250, up to 3) |
| X / H / G | crew abilities: suppressive fire, heal, getaway driver |
| R | change radio station (in a car) |
| M | city map |
| Esc or P | pause |
| F1 | help |

## What is in it

Each item below has a scripted headless-Chrome test in `tools/audit.mjs` and `tools/audit-features.mjs`.
Every test passes.

- **City:** 5 districts (Old Port, Neon Strip, Coral Heights, Vela Beach, Palmetto Park) on a road grid,
  with a beach, sea, pier and Ferris wheel. It has palms, neon trims, traffic, pedestrians and a
  day/night clock that starts at dusk.
- **10 story missions,** played in order, each unlocking the next. Each has a minimap marker, a
  world marker and a money and respect reward. Types: intro, delivery, eliminate, car theft,
  chase, bank heist, turf defence (3 waves), convoy ambush, precinct breakout (4★ pursuit) and a
  finale with a boss.
- **6 weapons:** Fists, Vela 9 Pistol, Riptide SMG, Breaker Shotgun, Tidewater Rifle and the
  Flarebird Launcher, which fires explosive rockets. You pick them with a weapon wheel that slows
  time to 25%.
- **5-star VPD dispatch:** crimes need a witness. The HUD shows a dispatch radio ticker. Cruisers
  take turns as RAM or PIT units. Roadblocks spawn ahead of you from 3★. From 4★ the **Air One**
  helicopter follows you with a searchlight that tracks you live. Stars hold while you are seen
  and fade once you are out of sight.
- **Cars:** damaged cars catch fire, then explode and leave a smoking wreck.
- **Crew** of 3 recruitable members who follow you and shoot hostiles. Their active abilities are
  suppressive fire, heal and getaway driver.
- **District standing** for each district, shown in the HUD and as a tint on the map. At 50+
  standing a district becomes your turf and pays income. There are named respect ranks.
- **3 street races** (Neon Strip Sprint, Coastline Run, Port Loop) with checkpoints, a countdown, a timer,
  3 rival drivers and cash prizes. Best times are saved.
- **Chrome & Coral Customs garage:** engine levels (speed), armor levels, respray and repair. All
  are saved.
- **3 radio stations,** synthesized with the Web Audio API: Vela Wave 88.3, Palm Bass 101.9 and
  Coral Lounge 94.1. Audio starts only after your first click or key press. Weapon, explosion,
  siren and engine sounds are synthesized too.
- **Autosave:** a versioned save that is written on an interval, after missions, races and garage
  purchases, and when the page closes. A corrupt save falls back to defaults and a backup is kept.
- **Minimap** with a GPS route line to the current objective.

## Tests

`tools/audit.mjs` drives the game in headless Chromium with Playwright. It blocks every non-localhost
request and fails if any is attempted. It fails on any console error or warning. It checks that Play
starts on the first click, presses every control and checks that the game state changes, and walks
and drives a bot into walls and corners from many angles to check the player never gets stuck. The
`f:` suites play the 10 missions, the police, the crew, the races, the garage, the weapons, the wrecks,
day/night, the GPS and the save. `tools/shoot.mjs` renders the screenshots from the game's own
`?shot=` scenes.

## License

MIT, see `LICENSE`.
