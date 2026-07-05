# Game Tank

Game Tank is a passive AI fishtank for retro games — a small always-open tab where an agent quietly plays whichever game you drop in. Open the tab and the tank resumes on its own: the game fills the screen, the agent swims, bubbles drift, and the chrome only appears when you hover.

## Run

```bash
npm install
npm run dev
```

Open the Vite URL and drop in a ROM (GBA, GB/GBC, NES, SNES, or Genesis — the right core is picked by file extension). No game ROMs are included.

## The tank

- **Auto-resume** — reopening the tab relaunches the last game from its latest checkpoint and puts the agent straight back on autopilot.
- **Ambient checkpoints** — the tank silently save-states every 3 minutes while the agent plays.
- **Float on desktop** — one click pops the tank into a Picture-in-Picture window that stays on top of everything.
- **Whisper bar** — hover the tank and type a live instruction ("catch something", "heal up") without opening the console.
- **Tank shelf** — multiple tanks, one per game/agent, switchable from the hover shelf.
- **Live tab title** — `▶ Emerald · Game Tank` so the tab reads like a status light.

## Console

The full cockpit is still there (hover → sliders icon, or Esc to come back): mission queue, stop rules, live log, checkpoints, manual pad, and save import/export.

## Product notes

The current agent is intentionally lightweight. A production agent would add a perception layer over screenshots/RAM, a task planner, hard game-specific guardrails, and cloud save custody. The emulator host is already shaped around those boundaries: controller input, screenshot/state capture, pause, resume, save, load, and user intervention.
