import Anthropic from "@anthropic-ai/sdk";
import type { ButtonName } from "./types";

export type BrainSettings = {
  enabled: boolean;
  apiKey: string;
  model: string;
  paceSeconds: number;
};

export type BrainContext = {
  gameName: string;
  goal: string;
  stopRules: string;
  queue: string[];
  liveInstruction: string;
  recentEvents: string[];
  screenPng: string;
};

export type BrainDecision = {
  thought: string;
  buttons: ButtonName[];
  needsHuman: boolean;
};

const BRAIN_KEY = "gametank.brain.v1";

const validButtons = new Set<ButtonName>([
  "up",
  "down",
  "left",
  "right",
  "a",
  "b",
  "l",
  "r",
  "start",
  "select",
]);

export function loadBrainSettings(): BrainSettings {
  const defaults: BrainSettings = {
    enabled: false,
    apiKey: "",
    model: "claude-opus-4-8",
    paceSeconds: 8,
  };

  try {
    const raw = localStorage.getItem(BRAIN_KEY);
    if (!raw) return defaults;
    return { ...defaults, ...(JSON.parse(raw) as Partial<BrainSettings>) };
  } catch {
    return defaults;
  }
}

export function saveBrainSettings(settings: BrainSettings) {
  localStorage.setItem(BRAIN_KEY, JSON.stringify(settings));
}

const systemPrompt = `You are the resident agent inside Game Tank, an ambient emulator fishtank. You play a retro game slowly and calmly while the user watches from another window.

Each turn you see the current screen plus the user's standing instructions, and you choose the next 1-8 button presses via the press_buttons tool.

Guidance:
- Advance dialog boxes with a. If the screen is mostly blank, the game is booting: press a or start.
- In menus, move deliberately: read what is selected before confirming, and prefer b to back out of menus you did not mean to open.
- To walk, repeat a direction 2-4 times. Vary routes when exploring.
- In battles, pick sensible moves; heal when clearly low.
- Follow the user's mission and any Latest order above all else.
- Keep the thought to one short present-tense sentence, like a calm aquarium narrator. No exclamation marks.
- Set needs_human true only when an action would cross one of the user's stop rules, or you have been stuck on the same screen for many turns. Explain why in the thought.`;

const pressButtonsTool: Anthropic.Messages.ToolUnion = {
  name: "press_buttons",
  description:
    "Press a sequence of Game Boy Advance buttons. Buttons are pressed in order, one at a time. An empty list means observe and wait this turn.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["thought", "buttons", "needs_human"],
    properties: {
      thought: {
        type: "string",
        description: "One short, calm sentence about what you see and what you are doing.",
      },
      buttons: {
        type: "array",
        description:
          "1-8 button presses in order. Repeat a direction to keep walking. Empty to just watch.",
        items: {
          type: "string",
          enum: ["up", "down", "left", "right", "a", "b", "l", "r", "start", "select"],
        },
      },
      needs_human: {
        type: "boolean",
        description:
          "True only if acting would break a stop rule or you are hopelessly stuck and need the user.",
      },
    },
  },
};

function contextText(context: BrainContext) {
  const lines = [
    `Game: ${context.gameName}`,
    `Mission: ${context.goal || "Keep the tank alive and make gentle progress."}`,
    `Stop rules: ${context.stopRules || "None."}`,
  ];

  if (context.queue.length) lines.push(`Mission queue: ${context.queue.join(" | ")}`);
  if (context.liveInstruction) lines.push(`Latest order (do this now): ${context.liveInstruction}`);
  if (context.recentEvents.length) {
    lines.push("", "Your recent thoughts (newest first):", ...context.recentEvents.map((text) => `- ${text}`));
  }

  return lines.join("\n");
}

export async function decideNextMove(
  settings: BrainSettings,
  context: BrainContext,
): Promise<BrainDecision> {
  const client = new Anthropic({
    apiKey: settings.apiKey.trim(),
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
    timeout: 30_000,
  });

  const response = await client.messages.create({
    model: settings.model,
    max_tokens: 300,
    system: systemPrompt,
    tools: [pressButtonsTool],
    tool_choice: { type: "tool", name: "press_buttons" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: context.screenPng },
          },
          { type: "text", text: contextText(context) },
        ],
      },
    ],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use",
  );

  if (!toolUse) {
    return { thought: "The water is murky; observing for a moment.", buttons: [], needsHuman: false };
  }

  const input = toolUse.input as {
    thought?: string;
    buttons?: string[];
    needs_human?: boolean;
  };

  const buttons = (input.buttons ?? [])
    .filter((button): button is ButtonName => validButtons.has(button as ButtonName))
    .slice(0, 8);

  return {
    thought: input.thought?.trim() || "Drifting along.",
    buttons,
    needsHuman: Boolean(input.needs_human),
  };
}

export function brainErrorMessage(error: unknown) {
  if (error instanceof Anthropic.AuthenticationError) {
    return "The API key was rejected. Check it in the console.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Rate limited by the API; slowing down.";
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Could not reach the Claude API.";
  }
  if (error instanceof Anthropic.APIError) {
    return `Claude API error ${error.status}: ${error.message}`;
  }
  return error instanceof Error ? error.message : "Brain request failed.";
}
