# A Building and a Playground

CSE 4204 Computer Graphics Lab, final project.
The building is the campus of Ahsanullah University of Science and Technology
(AUST), Tejgaon, Dhaka, laid out from street, drone, courtyard and satellite
photographs: a ring of eight storey wings round a courtyard, and at the front
the terracotta tower lettered AUST, the glass block with projecting floor
slabs, the stairs under a flat pergola carrying the Bengali and English name
board, the white block standing on columns, and the street wall with its red
disc. A playground sits in front, and the flag of Bangladesh flies on the
forecourt.

Three.js comes from npm and the code is split into ES modules, the same way the
lab projects are set up.

## How to run

```
cd building-and-playground
npm install
npm run dev
```

To hand in a static copy instead, `npm run build` writes one to `dist/` and
`npm run preview` serves it.

Open the address Vite prints (usually `http://localhost:5173`). The ring round
the button fills while the scene is built; then click it or press **Enter**.

`npm install` pulls Three.js r169 and Vite, so the machine needs internet the
first time only. Open the project through the dev server &mdash; opening
`index.html` directly will not work, because the browser refuses ES module
imports over `file://`.

Put your names and IDs in the `TEAM` list at the top of `js/main.js`; the start
screen and the build notes read them from there.

## Folder structure

```
building-and-playground/
├── index.html        markup, styles, the blueprint start sheet, HUD and the build notes panel
├── package.json      three + vite
└── js/
    ├── helpers.js      small maths helpers, the loader bar and the toast
    ├── textures.js     every texture, drawn with the 2D canvas API (3 window layouts x 5 colour schemes)
    ├── shaders.js      the GLSL programs and the materials built from them
    ├── renderer.js     renderer, perspective camera, orthographic camera
    ├── lighting.js     the one light that circles the building, sky colours, day and night
    ├── world.js        lawn, sky, forecourt, path, trees, grass, street lamps, benches, flag
    ├── building.js     the AUST campus (wings, tower, pergola, terraces, street wall) and the texture change
    ├── playground.js   swings, slide, see-saw, merry-go-round, dome, sandpit, fence
    ├── animation.js    moves the light round, the playground rides, fans and beacon
    ├── interaction.js  mouse, touch and keyboard
    └── main.js         team, HUD, camera rig, main loop and start up
```

Nothing is loaded from the internet while the scene runs. Every texture is
drawn in `textures.js` and every model is built from Three.js geometry, so no
image or model comes from an outside source.

## Controls

The three the brief asks for by name are at the top.

**The camera moves around the building**

| Input | Action |
| --- | --- |
| (nothing) | the camera circles the building on its own |
| Left / Right arrow, or Q / E | move the camera around the building |
| Up / Down arrow, or , / . | raise and lower the camera |
| - / = | move the camera out and in |
| Mouse drag | turn the camera around the building |
| Mouse wheel | zoom |
| A | hand the camera back to its own circle |
| 1 - 5 | orbit, playground, entrance, courtyard and overhead cameras |

**The texture of the building changes**

| Input | Action |
| --- | --- |
| (nothing) | a new colour scheme climbs every wall of the campus every 12 seconds |
| B | change the texture now (Shift + B goes back one) |
| V | turn the 12 second timer off and on |

**The light rotates around the building**

| Input | Action |
| --- | --- |
| (nothing) | the light circles the building on its own &mdash; it is the only light in the scene, and the sun (or moon) in the sky shows where it is |
| Z / X | step the light around by hand |
| R / F | raise and lower the light (its angle above the horizon) |
| J | hand the light back to its own timer |
| O | light colour |
| L | light on and off |
| K | light shadows on and off |

**Everything else**

| Input | Action |
| --- | --- |
| Click | name the object under the pointer |
| Space | pause and resume the animation |
| N | move the sun to night and back |
| T | let the sun move on its own |
| P | perspective / orthographic projection |
| [ and ] | field of view |
| W | wireframe |
| G | light helpers |
| H | hide the HUD |
| 0 | reset |
| I | the requirement table |

## Where each requirement lives

| Requirement | File |
| --- | --- |
| Custom shaders | `shaders.js` &mdash; complete GLSL programs for the sky, the building facade, the flag and the grass, plus two programs grown out of the standard material with `onBeforeCompile` for the lawn and the playground floor |
| Lighting | `lighting.js` &mdash; exactly one light source, a directional light whose position circles the building and casts all the shadows; no ambient, hemisphere, environment or lamp lights. The hand-written shaders do their own Blinn&ndash;Phong from the same light. Windows, lamp heads and the name board glow at night but light nothing |
| Perspective projection | `renderer.js` &mdash; `THREE.PerspectiveCamera`; an orthographic camera shares the same position so the two can be compared with **P** |
| Texture for every object | `textures.js` &mdash; three window layouts (ribbon glazing, square windows, courtyard corridors) in five colour schemes with a mask each, the AUST lettering, louvres, boundary wall panels, the Bengali and English name board, terracotta panels, herringbone brick paving, the flag of Bangladesh, paving, lawn, soil, sand, rubber, roof, concrete, timber, paint, steel, vents, solar cells, bark, leaves, doors, gate sign, merry-go-round deck |
| Animation | `animation.js` &mdash; the orbiting light, pendulum swings, see-saw, merry-go-round, spring rider; `building.js` &mdash; the facade wipe, roof fans and beacon; the flag and grass move in their vertex shaders; `main.js` &mdash; the camera circle |
| Mouse and keyboard | `interaction.js` &mdash; drag, wheel, click to pick an object, touch buttons and the key map above |
| **A building [with texture]** | `building.js` &mdash; `wallAlong` sweeps a textured wall along any footprint, `block` makes a rectangular block with a window layout per face; `buildTower`, `buildGlassBlock`, `buildCentreBlock`, `buildRightBlock`, `buildWings`, `buildStairs`, `buildPergola`, `buildTerraces`, `buildGateWall`, `buildRoofPlant` |
| **A playground [with texture]** | `playground.js` |
| **Camera moves around the building** | `main.js` `updateCamera` steps the orbit from the timer and the held keys; `interaction.js` handles the drag and the wheel |
| **The texture of the building changes** | `building.js` `requestSkin` / `updateFacade` drive `uMix` on all three facade shaders at once; `shaders.js` `makeFacadeMaterial` wipes between the two schemes bound to each |
| **The light rotates around the building** | `animation.js` `updateOrbitLight` moves the light round its circle every frame; `interaction.js` `onKey` lets Z / X, R / F and J hold, step and lift it |
