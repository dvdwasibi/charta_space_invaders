# Chart Invaders

A retro Phaser 3 arcade web game for Charta Health's promotional surface. Players pilot a Charta scanner ship and shoot descending chart errors before they cross the pre-billing line.

## Scripts

- `npm run dev` starts the local Vite server.
- `npm run build` type-checks and creates a production build.
- `npm run test` runs game-logic tests.

The app is static, stores high score in `localStorage`, and uses no backend. React owns the branded shell, HUD, overlays, and CTA; Phaser owns rendering, input, animation, Arcade Physics groups, and the live game loop.
