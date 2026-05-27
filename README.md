# Game Tank

Game Tank is a local prototype for an ambient AI-agent emulator desk. Users mount their own GBA ROM, assign a goal, let an agent run lightweight controller loops, and intervene whenever the session needs human judgment.

## Run

```bash
npm install
npm run dev
```

Open the Vite URL, mount a `.gba` file, and launch the core. No game ROMs are included.

## What works now

- Browser-hosted GBA emulator via Nostalgist.js and the mGBA RetroArch core.
- Local per-agent profiles with ROM metadata, goals, event log, pace, mode, and guardrail state.
- Save-state capture/load/export and best-effort SRAM capture.
- Manual controller intervention.
- Autopilot loop that maps goal text to safe controller-input routines.
- Corner-watch mode for the ambient stream shape.

## Product notes

The current agent is intentionally lightweight. A production agent would add a perception layer over screenshots/RAM, a task planner, hard game-specific guardrails, and cloud save custody. The emulator host is already shaped around those boundaries: controller input, screenshot/state capture, pause, resume, save, load, and user intervention.
