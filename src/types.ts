export type AgentMode = "standby" | "autopilot" | "intervention";

export type EventTone = "system" | "agent" | "user" | "save" | "risk";

export type ProfileEvent = {
  id: string;
  at: number;
  tone: EventTone;
  text: string;
};

export type SaveSlot = {
  id: string;
  name: string;
  createdAt: number;
  stateKey: string;
  thumbnailKey?: string;
};

export type AgentProfile = {
  id: string;
  userName: string;
  agentName: string;
  gameName: string;
  romKey?: string;
  romName?: string;
  goal: string;
  stopRules: string;
  goalQueue: string[];
  liveInstruction: string;
  mode: AgentMode;
  paceMs: number;
  guardrailArmed: boolean;
  ticks: number;
  updatedAt: number;
  createdAt: number;
  lastSramKey?: string;
  saves: SaveSlot[];
  events: ProfileEvent[];
};

export type ButtonName =
  | "up"
  | "down"
  | "left"
  | "right"
  | "a"
  | "b"
  | "l"
  | "r"
  | "start"
  | "select";

export type ScreenMode = "empty" | "booting" | "field" | "dialog" | "battle" | "menu" | "unknown";

export type ScreenObservation = {
  mode: ScreenMode;
  confidence: number;
  brightness: number;
  contrast: number;
  motion: number;
  sampledAt: number;
  summary: string;
};

export type AgentAction = {
  label: string;
  thought: string;
  buttons: ButtonName[];
  risk?: boolean;
};
