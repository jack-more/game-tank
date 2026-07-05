import type { AgentAction, ButtonName, ScreenObservation } from "./types";

const roamPattern: ButtonName[][] = [
  ["up"],
  ["up"],
  ["left"],
  ["right"],
  ["down"],
  ["a"],
  ["b"],
];

const grindPattern: ButtonName[][] = [
  ["left"],
  ["right"],
  ["left"],
  ["right"],
  ["a"],
  ["a"],
  ["b"],
];

const catchPattern: ButtonName[][] = [
  ["up"],
  ["down"],
  ["left"],
  ["right"],
  ["a"],
  ["a"],
  ["b"],
  ["start"],
];

function includesAny(goal: string, words: string[]) {
  return words.some((word) => goal.includes(word));
}

function withVision(thought: string, observation?: ScreenObservation) {
  if (!observation) return thought;
  return `${thought} Vision: ${observation.summary}.`;
}

export function wantsGuardrail(goal: string) {
  const normalized = goal.toLowerCase();
  return includesAny(normalized, [
    "do not",
    "don't",
    "dont",
    "stop before",
    "without letting me know",
    "before gym",
    "first gym",
    "ask me",
    "notify",
  ]);
}

export function nextAgentAction(goal: string, tick: number, observation?: ScreenObservation): AgentAction {
  const normalized = goal.toLowerCase();
  const guardrail = wantsGuardrail(normalized);
  const wantsCatch = includesAny(normalized, ["catch", "capture", "find", "nidorino", "encounter"]);
  const wantsGrind = includesAny(normalized, ["level", "grind", "evolve", "train", "xp", "ev"]);

  if (guardrail && tick > 0 && tick % 150 === 0) {
    return {
      label: "Guardrail check",
      thought: withVision(
        "Goal contains a progress boundary. I should pause before pushing past a story gate.",
        observation,
      ),
      buttons: [],
      risk: true,
    };
  }

  if (observation?.mode === "booting" || observation?.mode === "unknown") {
    return {
      label: "Screen sync",
      thought: withVision("The screen is not readable enough yet, so I am using gentle confirm/start inputs.", observation),
      buttons: tick % 2 === 0 ? ["a"] : ["start"],
    };
  }

  if (observation?.mode === "dialog") {
    return {
      label: "Dialog confirm",
      thought: withVision("A prompt or text box appears active. I am confirming one step, then re-reading.", observation),
      buttons: ["a"],
    };
  }

  if (observation?.mode === "menu") {
    return {
      label: "Menu recover",
      thought: withVision("The display looks menu-heavy. I am backing out unless the next command says otherwise.", observation),
      buttons: ["b"],
    };
  }

  if (observation?.mode === "battle") {
    if (wantsCatch) {
      return {
        label: "Catch setup",
        thought: withVision("Battle-like layout detected while a catch goal is active. I am nudging toward the bag flow.", observation),
        buttons: ["right", "a"],
      };
    }

    return {
      label: "Battle confirm",
      thought: withVision("Battle-like layout detected. I am selecting the conservative first action.", observation),
      buttons: wantsGrind ? ["a", "a"] : ["a"],
    };
  }

  if (observation && observation.motion < 0.02 && tick > 2 && tick % 5 === 0) {
    return {
      label: "Unstick check",
      thought: withVision("The frame has barely changed. I am sending a single confirm to test for a hidden prompt.", observation),
      buttons: ["a"],
    };
  }

  if (wantsCatch) {
    const buttons = catchPattern[tick % catchPattern.length];
    return {
      label: "Encounter sweep",
      thought: withVision("Searching grass, confirming prompts, and keeping the route loop shallow.", observation),
      buttons,
    };
  }

  if (wantsGrind) {
    const buttons = grindPattern[tick % grindPattern.length];
    return {
      label: "Grind loop",
      thought: withVision("Oscillating through safe movement and battle confirmation inputs.", observation),
      buttons,
    };
  }

  const buttons = roamPattern[tick % roamPattern.length];
  return {
    label: "Roam",
    thought: withVision("Maintaining a conservative exploration loop while waiting for clearer orders.", observation),
    buttons,
  };
}

export function buttonLabel(button: ButtonName) {
  const labels: Record<ButtonName, string> = {
    up: "Up",
    down: "Down",
    left: "Left",
    right: "Right",
    a: "A",
    b: "B",
    l: "L",
    r: "R",
    start: "Start",
    select: "Select",
  };

  return labels[button];
}
