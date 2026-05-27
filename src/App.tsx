import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bot,
  Box,
  Circle,
  Download,
  Gamepad2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Plus,
  Upload,
  Zap,
} from "lucide-react";
import { Nostalgist } from "nostalgist";
import { buttonLabel, nextAgentAction, wantsGuardrail } from "./agent";
import {
  addProfileEvent,
  createProfile,
  downloadBlob,
  getBlob,
  loadProfiles,
  putBlob,
  saveProfiles,
} from "./storage";
import type { AgentMode, AgentProfile, ButtonName, SaveSlot, ScreenMode, ScreenObservation } from "./types";

type EmulatorInstance = Awaited<ReturnType<typeof Nostalgist.launch>>;
type CommandMode = "queue" | "now";

const buttonIcons: Partial<Record<ButtonName, ReactNode>> = {
  up: <ArrowUp size={16} />,
  down: <ArrowDown size={16} />,
  left: <ArrowLeft size={16} />,
  right: <ArrowRight size={16} />,
};

const manualButtons: ButtonName[] = ["l", "r", "select", "start", "b", "a"];
const visionWidth = 160;

function formatTime(ms: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(ms);
}

function bytesLabel(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function linesFromText(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function App() {
  const [profiles, setProfiles] = useState<AgentProfile[]>(() => loadProfiles());
  const [activeId, setActiveId] = useState(() => profiles[0]?.id ?? "");
  const [isLaunching, setIsLaunching] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [cornerMode, setCornerMode] = useState(false);
  const [status, setStatus] = useState("Standby");
  const [romSize, setRomSize] = useState<number>();
  const [commandDraft, setCommandDraft] = useState("");
  const [commandMode, setCommandMode] = useState<CommandMode>("queue");
  const [screenObservation, setScreenObservation] = useState<ScreenObservation>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const emulatorRef = useRef<EmulatorInstance | null>(null);
  const visionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameSignatureRef = useRef<number[]>([]);
  const screenObservationRef = useRef<ScreenObservation | undefined>(undefined);
  const romInputRef = useRef<HTMLInputElement | null>(null);
  const stateInputRef = useRef<HTMLInputElement | null>(null);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeId) ?? profiles[0],
    [activeId, profiles],
  );
  const missionLines = linesFromText(activeProfile?.goal ?? "");
  const ruleLines = linesFromText(activeProfile?.stopRules ?? "");
  const queueText = activeProfile?.goalQueue.join("\n") ?? "";
  const objectiveText = `${activeProfile?.goal ?? ""}\n${activeProfile?.stopRules ?? ""}\n${queueText}\n${activeProfile?.liveInstruction ?? ""}`;

  useEffect(() => {
    saveProfiles(profiles);
  }, [profiles]);

  useEffect(() => {
    return () => {
      void emulatorRef.current?.exit();
    };
  }, []);

  function updateActiveProfile(updater: (profile: AgentProfile) => AgentProfile) {
    setProfiles((current) =>
      current.map((profile) => (profile.id === activeProfile.id ? updater(profile) : profile)),
    );
  }

  function logEvent(tone: Parameters<typeof addProfileEvent>[1], text: string) {
    updateActiveProfile((profile) => addProfileEvent(profile, tone, text));
  }

  function observeScreen(): ScreenObservation | undefined {
    const canvas = canvasRef.current;
    if (!canvas || !isLoaded) return undefined;

    const sourceWidth = canvas.width || canvas.clientWidth;
    const sourceHeight = canvas.height || canvas.clientHeight;
    if (!sourceWidth || !sourceHeight) return undefined;

    try {
      const sampleCanvas = visionCanvasRef.current ?? document.createElement("canvas");
      visionCanvasRef.current = sampleCanvas;

      const sampleHeight = Math.max(1, Math.round(visionWidth * (sourceHeight / sourceWidth)));
      sampleCanvas.width = visionWidth;
      sampleCanvas.height = sampleHeight;

      const context = sampleCanvas.getContext("2d", { willReadFrequently: true });
      if (!context) return undefined;

      context.drawImage(canvas, 0, 0, visionWidth, sampleHeight);
      const { data } = context.getImageData(0, 0, visionWidth, sampleHeight);

      let sum = 0;
      let sumSquares = 0;
      let samples = 0;
      let topSum = 0;
      let topSamples = 0;
      let bottomSum = 0;
      let bottomSamples = 0;
      let veryLight = 0;
      const signature: number[] = [];
      const step = 4;

      for (let y = 0; y < sampleHeight; y += step) {
        for (let x = 0; x < visionWidth; x += step) {
          const index = (y * visionWidth + x) * 4;
          const luma = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
          sum += luma;
          sumSquares += luma * luma;
          samples += 1;
          if (luma > 186) veryLight += 1;
          if (y < sampleHeight * 0.25) {
            topSum += luma;
            topSamples += 1;
          }
          if (y > sampleHeight * 0.68) {
            bottomSum += luma;
            bottomSamples += 1;
          }
          if (x % 16 === 0 && y % 16 === 0) {
            signature.push(Math.round(luma / 8) * 8);
          }
        }
      }

      const brightness = sum / samples;
      const variance = Math.max(0, sumSquares / samples - brightness * brightness);
      const contrast = Math.sqrt(variance);
      const topBrightness = topSamples ? topSum / topSamples : brightness;
      const bottomBrightness = bottomSamples ? bottomSum / bottomSamples : brightness;
      const previousSignature = frameSignatureRef.current;
      const comparable = Math.min(previousSignature.length, signature.length);
      const motion = comparable
        ? signature
            .slice(0, comparable)
            .reduce((total, value, index) => total + Math.abs(value - previousSignature[index]), 0) /
          comparable /
          255
        : 0;
      frameSignatureRef.current = signature;

      const lightShare = veryLight / samples;
      let mode: ScreenMode = "field";
      let confidence = 0.52;

      if (brightness < 8 || contrast < 3) {
        mode = "booting";
        confidence = 0.82;
      } else if (bottomBrightness > brightness + 18 && (bottomBrightness > 112 || lightShare > 0.22)) {
        mode = "dialog";
        confidence = 0.74;
      } else if (topBrightness > brightness + 18 && bottomBrightness > brightness + 10) {
        mode = "menu";
        confidence = 0.62;
      } else if (contrast > 54 && (topBrightness > brightness + 10 || bottomBrightness > brightness + 10)) {
        mode = "battle";
        confidence = 0.58;
      } else if (contrast < 12 && motion < 0.015) {
        mode = "unknown";
        confidence = 0.48;
      }

      return {
        mode,
        confidence,
        brightness,
        contrast,
        motion,
        sampledAt: Date.now(),
        summary: `${mode} ${(confidence * 100).toFixed(0)}%, motion ${motion.toFixed(2)}`,
      };
    } catch {
      return {
        mode: "unknown",
        confidence: 0,
        brightness: 0,
        contrast: 0,
        motion: 0,
        sampledAt: Date.now(),
        summary: "vision sample unavailable",
      };
    }
  }

  async function launchProfile(profile = activeProfile) {
    if (!profile?.romKey || !canvasRef.current) return;

    setIsLaunching(true);
    setStatus("Launching core");

    try {
      await emulatorRef.current?.exit();
      const rom = await getBlob(profile.romKey);
      const sram = await getBlob(profile.lastSramKey);
      if (!rom) throw new Error("ROM was not found in local storage.");

      const romFile = new File([rom], profile.romName ?? "game.gba", {
        type: "application/octet-stream",
      });

      setRomSize(rom.size);

      const instance = await Nostalgist.launch({
        element: canvasRef.current,
        core: "mgba",
        rom: romFile,
        sram,
        sramType: "sav",
        respondToGlobalEvents: false,
        cache: { core: true, rom: false, bios: false, shader: true },
        retroarchConfig: {
          savestate_thumbnail_enable: true,
          video_smooth: false,
        },
        style: {
          width: "100%",
          height: "100%",
          imageRendering: "pixelated",
        },
      });

      emulatorRef.current = instance;
      setIsLoaded(true);
      setStatus("Ready");
      setIsLaunching(false);
      updateActiveProfile((current) =>
        addProfileEvent(
          { ...current, gameName: profile.romName?.replace(/\.gba$/i, "") ?? current.gameName },
          "system",
          "GBA core attached.",
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not launch emulator.";
      setStatus(message);
      setIsLoaded(false);
      setIsLaunching(false);
      logEvent("risk", message);
    }
  }

  async function handleRomFile(file?: File) {
    if (!file) return;

    const key = `${activeProfile.id}.rom`;
    await putBlob(key, file);
    setRomSize(file.size);

    updateActiveProfile((profile) =>
      addProfileEvent(
        {
          ...profile,
          romKey: key,
          romName: file.name,
          gameName: file.name.replace(/\.gba$/i, ""),
          updatedAt: Date.now(),
        },
        "system",
        `ROM mounted: ${file.name}`,
      ),
    );

    setTimeout(() => void launchProfile({ ...activeProfile, romKey: key, romName: file.name }), 50);
  }

  async function press(button: ButtonName, time = 110) {
    if (!emulatorRef.current || !isLoaded) return;
    await emulatorRef.current.press({ button, time });
  }

  useEffect(() => {
    const keyMap: Record<string, ButtonName> = {
      arrowup: "up",
      w: "up",
      arrowdown: "down",
      s: "down",
      arrowleft: "left",
      a: "left",
      arrowright: "right",
      d: "right",
      x: "a",
      z: "b",
      c: "l",
      v: "r",
    };

    function isTypingTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;
      return (
        target.isContentEditable ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT"
      );
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      const button = keyMap[event.key.toLowerCase()];
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      void press(button, 95);
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isLoaded]);

  async function runButtons(buttons: ButtonName[]) {
    for (const button of buttons) {
      await press(button, 100);
      await new Promise((resolve) => window.setTimeout(resolve, 70));
    }
  }

  useEffect(() => {
    if (!isLoaded) {
      setScreenObservation(undefined);
      screenObservationRef.current = undefined;
      frameSignatureRef.current = [];
      return;
    }

    const sample = () => {
      const observation = observeScreen();
      if (observation) {
        screenObservationRef.current = observation;
        setScreenObservation(observation);
      }
    };

    sample();
    const timer = window.setInterval(sample, 900);
    return () => window.clearInterval(timer);
  }, [isLoaded]);

  useEffect(() => {
    if (!activeProfile || activeProfile.mode !== "autopilot" || !isLoaded) return;

    let cancelled = false;
    const timer = window.setInterval(() => {
      const observation = observeScreen();
      if (observation) {
        screenObservationRef.current = observation;
        setScreenObservation(observation);
      }
      const action = nextAgentAction(objectiveText, activeProfile.ticks, observation ?? screenObservationRef.current);

      if (action.risk) {
        setStatus("Guardrail pause");
        updateActiveProfile((profile) =>
          addProfileEvent(
            { ...profile, mode: "intervention", ticks: profile.ticks + 1 },
            "risk",
            action.thought,
          ),
        );
        return;
      }

      setStatus(action.label);
      updateActiveProfile((profile) =>
        addProfileEvent({ ...profile, ticks: profile.ticks + 1 }, "agent", action.thought),
      );

      if (!cancelled) {
        void runButtons(action.buttons);
      }
    }, activeProfile.paceMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    activeProfile?.id,
    activeProfile?.mode,
    activeProfile?.paceMs,
    activeProfile?.ticks,
    isLoaded,
    objectiveText,
  ]);

  function setMode(mode: AgentMode) {
    updateActiveProfile((profile) =>
      addProfileEvent(
        { ...profile, mode },
        mode === "autopilot" ? "agent" : "user",
        mode === "autopilot" ? "Autopilot resumed." : "Manual intervention active.",
      ),
    );
  }

  async function saveState() {
    if (!emulatorRef.current) return;

    setStatus("Saving state");
    const { state, thumbnail } = await emulatorRef.current.saveState();
    const stateKey = `${activeProfile.id}.state.${Date.now()}`;
    const thumbnailKey = thumbnail ? `${stateKey}.thumb` : undefined;
    await putBlob(stateKey, state);
    if (thumbnail && thumbnailKey) await putBlob(thumbnailKey, thumbnail);

    let sramKey = activeProfile.lastSramKey;
    try {
      const sram = await emulatorRef.current.saveSRAM();
      sramKey = `${activeProfile.id}.sram`;
      await putBlob(sramKey, sram);
    } catch {
      // Some games do not expose SRAM before an in-game save exists.
    }

    const slot: SaveSlot = {
      id: crypto.randomUUID(),
      name: `State ${activeProfile.saves.length + 1}`,
      createdAt: Date.now(),
      stateKey,
      thumbnailKey,
    };

    updateActiveProfile((profile) =>
      addProfileEvent(
        {
          ...profile,
          lastSramKey: sramKey,
          saves: [slot, ...profile.saves].slice(0, 8),
          updatedAt: Date.now(),
        },
        "save",
        `${slot.name} stored.`,
      ),
    );

    setStatus("State saved");
  }

  async function loadSave(slot = activeProfile.saves[0]) {
    if (!emulatorRef.current || !slot) return;
    const state = await getBlob(slot.stateKey);
    if (!state) return;

    await emulatorRef.current.loadState(state);
    setStatus("State loaded");
    logEvent("save", `${slot.name} restored.`);
  }

  async function exportLatest() {
    const slot = activeProfile.saves[0];
    if (!slot) return;
    const state = await getBlob(slot.stateKey);
    if (!state) return;
    downloadBlob(state, `${activeProfile.agentName}-${slot.name}.state`.replace(/\s+/g, "-"));
  }

  async function importState(file?: File) {
    if (!file) return;
    if (!emulatorRef.current) {
      logEvent("risk", "Launch the ROM before importing a state.");
      return;
    }

    await emulatorRef.current.loadState(file);
    const stateKey = `${activeProfile.id}.state.${Date.now()}`;
    await putBlob(stateKey, file);
    const slot: SaveSlot = {
      id: crypto.randomUUID(),
      name: "Imported state",
      createdAt: Date.now(),
      stateKey,
    };

    updateActiveProfile((profile) =>
      addProfileEvent(
        { ...profile, saves: [slot, ...profile.saves].slice(0, 8) },
        "save",
        "Imported state loaded.",
      ),
    );
  }

  function addProfile() {
    const profile = createProfile(profiles.length + 1);
    setProfiles((current) => [profile, ...current]);
    setActiveId(profile.id);
    setIsLoaded(false);
    void emulatorRef.current?.exit();
  }

  function addQueueItem(text: string, source = "Command") {
    const item = text.trim();
    if (!item) return;
    updateActiveProfile((profile) =>
      addProfileEvent(
        {
          ...profile,
          goalQueue: [...profile.goalQueue, item].slice(0, 12),
          mode: "autopilot",
          guardrailArmed: wantsGuardrail(
            `${profile.goal} ${profile.stopRules} ${profile.liveInstruction} ${profile.goalQueue.join(" ")} ${item}`,
          ),
        },
        "user",
        `${source} added to Mission Queue: ${item}`,
      ),
    );
  }

  function submitCommand() {
    const text = commandDraft.trim();
    if (!text) return;
    setCommandDraft("");
    if (commandMode === "queue") {
      addQueueItem(text);
      return;
    }

    setOverrideInstruction(text);
  }

  function setOverrideInstruction(text: string) {
    const item = text.trim();
    if (!item) return;
    updateActiveProfile((profile) =>
      addProfileEvent(
        {
          ...profile,
          liveInstruction: item,
          mode: "autopilot",
          guardrailArmed: wantsGuardrail(`${profile.goal} ${profile.stopRules} ${profile.goalQueue.join(" ")} ${item}`),
        },
        "user",
        `Override: ${item}`,
      ),
    );
  }

  function promoteQueueItem(index: number) {
    updateActiveProfile((profile) => {
      const item = profile.goalQueue[index];
      if (!item) return profile;
      const nextQueue = profile.goalQueue.filter((_, itemIndex) => itemIndex !== index);
      return addProfileEvent(
        {
          ...profile,
          liveInstruction: item,
          goalQueue: nextQueue,
          mode: "autopilot",
          guardrailArmed: wantsGuardrail(`${profile.goal} ${profile.stopRules} ${nextQueue.join(" ")} ${item}`),
        },
        "user",
        `Promoted to Do Now: ${item}`,
      );
    });
  }

  function moveQueueItem(index: number, direction: -1 | 1) {
    updateActiveProfile((profile) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= profile.goalQueue.length) return profile;
      const nextQueue = [...profile.goalQueue];
      [nextQueue[index], nextQueue[targetIndex]] = [nextQueue[targetIndex], nextQueue[index]];
      return {
        ...profile,
        goalQueue: nextQueue,
        updatedAt: Date.now(),
      };
    });
  }

  function removeQueueItem(index: number) {
    updateActiveProfile((profile) => {
      const item = profile.goalQueue[index];
      if (!item) return profile;
      return addProfileEvent(
        {
          ...profile,
          goalQueue: profile.goalQueue.filter((_, itemIndex) => itemIndex !== index),
        },
        "user",
        `Removed queued item: ${item}`,
      );
    });
  }

  function updateRuleLine(index: number, value: string) {
    updateActiveProfile((profile) => {
      const nextRules = linesFromText(profile.stopRules);
      nextRules[index] = value;
      const stopRules = nextRules.join("\n");
      return {
        ...profile,
        stopRules,
        guardrailArmed: wantsGuardrail(
          `${profile.goal} ${stopRules} ${profile.goalQueue.join(" ")} ${profile.liveInstruction}`,
        ),
        updatedAt: Date.now(),
      };
    });
  }

  function addRuleLine() {
    updateActiveProfile((profile) => {
      const nextRules = [...linesFromText(profile.stopRules), "New stop rule"];
      const stopRules = nextRules.join("\n");
      return {
        ...profile,
        stopRules,
        guardrailArmed: wantsGuardrail(
          `${profile.goal} ${stopRules} ${profile.goalQueue.join(" ")} ${profile.liveInstruction}`,
        ),
        updatedAt: Date.now(),
      };
    });
  }

  function removeRuleLine(index: number) {
    updateActiveProfile((profile) => {
      const nextRules = linesFromText(profile.stopRules).filter((_, ruleIndex) => ruleIndex !== index);
      const stopRules = nextRules.join("\n");
      return {
        ...profile,
        stopRules,
        guardrailArmed: wantsGuardrail(
          `${profile.goal} ${stopRules} ${profile.goalQueue.join(" ")} ${profile.liveInstruction}`,
        ),
        updatedAt: Date.now(),
      };
    });
  }

  function applyQuickCommand(text: string) {
    if (commandMode === "queue") {
      addQueueItem(text, "Quick goal");
      return;
    }

    setOverrideInstruction(text);
  }

  const canLaunch = Boolean(activeProfile?.romKey);
  const lastEvent = activeProfile?.events[0];
  const mode = activeProfile?.mode ?? "standby";

  return (
    <main className={cornerMode ? "app hybrid-app corner-mode" : "app hybrid-app"}>
      <header className="gt-header">
        <div className="brand-lockup">
          <div className="brand-glyph">
            <Circle size={9} fill="currentColor" />
          </div>
          <strong>Game Tank</strong>
          <span className="divider" />
          <span className="cartridge-label">Cartridge // Emerald</span>
        </div>

        <div className="header-meta">
          <div className="agent-state">
            <span className={`pulse ${mode}`} />
            <span>Agent {mode === "autopilot" ? "active" : mode} : {status}</span>
          </div>
          <span className="speed-chip">1x Watch</span>
          <span className="key-hints">WASD/Arrows // X=A Z=B C=L V=R</span>
          <span className="session-clock">T+ {String(activeProfile.ticks).padStart(4, "0")}</span>
        </div>
      </header>

      <div className="gt-body">
        <section className="tank-stage">
          <div className="stage-rulers" />

          <div className="profile-dock" aria-label="Agent slots">
            {profiles.map((profile) => (
              <button
                className={profile.id === activeProfile.id ? "dock-agent active" : "dock-agent"}
                key={profile.id}
                onClick={() => {
                  setActiveId(profile.id);
                  setIsLoaded(false);
                  setStatus("Standby");
                  void emulatorRef.current?.exit();
                }}
              >
                <Bot size={14} />
                <span>{profile.agentName}</span>
                <small>{profile.romName ?? "No ROM"}</small>
              </button>
            ))}
            <button className="dock-add" onClick={addProfile} title="New agent">
              <Plus size={15} />
            </button>
          </div>

          <div className="tank-center">
            <div className="agent-thought">
              <span>[AGENT.COG]</span>
              <p>{lastEvent?.text ?? "Awaiting cartridge mount and mission directive."}</p>
            </div>

            <div className="emulator-object">
              <div className="emulator-status">
                <span className={`pulse ${mode}`} />
                <strong>{activeProfile.gameName}</strong>
                <span>{activeProfile.agentName}</span>
                {activeProfile.romName && <span>{bytesLabel(romSize)}</span>}
                <span className="vision-pill">
                  Vision // {screenObservation ? screenObservation.mode : "offline"}
                </span>
                <button
                  className="glass-button corner-toggle"
                  title={cornerMode ? "Exit corner" : "Corner watch"}
                  onClick={() => setCornerMode((value) => !value)}
                >
                  {cornerMode ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
                </button>
              </div>

              <div className="screen-frame">
                <canvas ref={canvasRef} className={isLoaded ? "gba-canvas loaded" : "gba-canvas"} />
                <div className="screen-glass" />
                <div className="scanlines" />

                {!isLoaded && (
                  <div className="empty-screen">
                    <Box size={28} />
                    <strong>{isLaunching ? "Preparing core" : "Mount a .gba file"}</strong>
                    <button className="primary-button" onClick={() => romInputRef.current?.click()}>
                      <Upload size={16} />
                      ROM
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="intervention-deck">
              <div className="handoff-row">
                <div className="handoff-actions">
                  <button
                    className="takeover-button"
                    onClick={() => setMode("intervention")}
                    disabled={!isLoaded}
                  >
                    <Zap size={15} />
                    Take Over
                  </button>
                  <button className="outline-button" onClick={() => setMode("intervention")} disabled={!isLoaded}>
                    <Pause size={13} />
                    Pause
                  </button>
                  <button className="outline-button" onClick={() => setMode("autopilot")} disabled={!isLoaded}>
                    <Play size={13} />
                    Resume
                  </button>
                </div>
              </div>

              <form
                className="command-dock"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitCommand();
                }}
              >
                <ArrowRight size={16} />
                <div className="command-mode-toggle" aria-label="Command mode">
                  <button
                    type="button"
                    className={commandMode === "queue" ? "active" : ""}
                    onClick={() => setCommandMode("queue")}
                  >
                    Queue
                  </button>
                  <button
                    type="button"
                    className={commandMode === "now" ? "active" : ""}
                    onClick={() => setCommandMode("now")}
                  >
                    Do Now
                  </button>
                </div>
                <input
                  value={commandDraft}
                  onChange={(event) => setCommandDraft(event.target.value)}
                  placeholder={commandMode === "queue" ? "Add to Mission Queue..." : "Interrupt with Do Now..."}
                />
                <button className="command-submit" type="submit" disabled={!commandDraft.trim()}>
                  {commandMode === "queue" ? "Add" : "Run"}
                </button>
              </form>

              <div className="macro-strip">
                <span>Quick Goals //</span>
                {["Grind", "Heal", "Catch"].map((macro) => (
                  <button key={macro} onClick={() => applyQuickCommand(macro)}>
                    {macro}
                  </button>
                ))}
                <button onClick={() => applyQuickCommand("Save at next safe point")}>
                  Save
                </button>
                <button className="selected" onClick={() => applyQuickCommand("Stay in Zone")}>
                  <span />
                  Stay in Zone
                </button>
              </div>

              <div className="manual-pad">
                <div className="dpad">
                  {(["up", "left", "right", "down"] as ButtonName[]).map((button) => (
                    <button
                      className={`pad-button ${button}`}
                      key={button}
                      title={buttonLabel(button)}
                      onClick={() => void press(button)}
                      disabled={!isLoaded}
                    >
                      {buttonIcons[button]}
                    </button>
                  ))}
                </div>

                <div className="button-strip">
                  {manualButtons.map((button) => (
                    <button
                      className={button === "a" || button === "b" ? "face-button" : "chip-button"}
                      key={button}
                      title={buttonLabel(button)}
                      onClick={() => void press(button, button.length > 1 ? 150 : 110)}
                      disabled={!isLoaded}
                    >
                      {buttonLabel(button)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="right-console">
          <section className="directive-block mission-queue-panel">
            <div className="section-header">01 Mission Queue</div>
            <div className="mission-queue-list">
              <article className="mission-primary">
                <span>Prime</span>
                <textarea
                  value={activeProfile.goal}
                  onChange={(event) =>
                    updateActiveProfile((profile) => ({
                      ...profile,
                      goal: event.target.value,
                      guardrailArmed: wantsGuardrail(
                        `${event.target.value} ${profile.stopRules} ${profile.goalQueue.join(" ")} ${profile.liveInstruction}`,
                      ),
                      updatedAt: Date.now(),
                    }))
                  }
                />
              </article>

              {activeProfile.goalQueue.map((item, index) => (
                <article className="queue-item" key={`${item}-${index}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{item}</p>
                  <div className="queue-controls">
                    <button onClick={() => moveQueueItem(index, -1)} disabled={index === 0} title="Move up">
                      <ArrowUp size={11} />
                    </button>
                    <button
                      onClick={() => moveQueueItem(index, 1)}
                      disabled={index === activeProfile.goalQueue.length - 1}
                      title="Move down"
                    >
                      <ArrowDown size={11} />
                    </button>
                    <button onClick={() => promoteQueueItem(index)} title="Run now">
                      Now
                    </button>
                    <button onClick={() => removeQueueItem(index)} title="Remove">
                      X
                    </button>
                  </div>
                </article>
              ))}

              {!activeProfile.goalQueue.length && missionLines.length > 0 && (
                <div className="queue-empty">Command dock adds more bullets here.</div>
              )}
            </div>
          </section>

          <section className="directive-block rules-panel">
            <div className="section-header">02 Rules</div>
            <div className="rules-stack">
              <div className="rule-list">
                {ruleLines.map((rule, index) => (
                  <label className="rule-item" key={`${rule}-${index}`}>
                    <span />
                    <input
                      value={rule}
                      onChange={(event) => updateRuleLine(index, event.target.value)}
                    />
                    <button type="button" onClick={() => removeRuleLine(index)} title="Remove rule">
                      X
                    </button>
                  </label>
                ))}
                {!ruleLines.length && <div className="queue-empty">No rules. Add a stop rule before grinding.</div>}
              </div>

              <button className="add-line-button" type="button" onClick={addRuleLine}>
                <Plus size={12} />
                Add Rule
              </button>

              <div className={activeProfile.guardrailArmed ? "guardrail-line armed" : "guardrail-line"}>
                <span>{activeProfile.guardrailArmed ? "!" : "-"}</span>
                {activeProfile.guardrailArmed ? "Stop rule armed from current rules." : "No stop phrase detected."}
              </div>
            </div>
          </section>

          <section className="telemetry-panel">
            <div className="section-header live-header">
              <span>03 Live Log</span>
              <strong>Live</strong>
            </div>
            <div className="event-list">
              {activeProfile.events.map((event) => (
                <article className={`event ${event.tone}`} key={event.id}>
                  <div>
                    <span>{formatTime(event.at)}</span>
                    <strong>{event.tone}</strong>
                  </div>
                  <p>{event.text}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="checkpoint-panel" aria-label="Memory checkpoints">
            <div className="section-header">04 Checkpoints</div>
            <div className="checkpoint-grid">
              {activeProfile.saves.map((slot, index) => (
                <button className="checkpoint" key={slot.id} onClick={() => void loadSave(slot)}>
                  <span>M_{String(index + 1).padStart(2, "0")}</span>
                  <strong>{formatTime(slot.createdAt)}</strong>
                </button>
              ))}
              <button className="checkpoint new" onClick={() => void saveState()} disabled={!isLoaded}>
                <span>New</span>
                <Plus size={12} />
              </button>
              <button
                className="checkpoint utility"
                onClick={() => void loadSave()}
                disabled={!isLoaded || !activeProfile.saves.length}
              >
                <span>Load</span>
                <Play size={12} />
              </button>
              <button className="checkpoint utility" onClick={() => romInputRef.current?.click()}>
                <span>ROM</span>
                <Upload size={12} />
              </button>
              <button className="checkpoint utility" onClick={() => void launchProfile()} disabled={!canLaunch}>
                <span>Run</span>
                <Gamepad2 size={12} />
              </button>
              <button
                className="checkpoint utility"
                onClick={() => void exportLatest()}
                disabled={!activeProfile.saves.length}
              >
                <span>Out</span>
                <Download size={12} />
              </button>
              <button className="checkpoint utility" onClick={() => stateInputRef.current?.click()}>
                <span>In</span>
                <Upload size={12} />
              </button>
            </div>
          </section>
        </aside>
      </div>

      {lastEvent && cornerMode && (
        <div className={`corner-caption ${lastEvent.tone}`}>
          <div>
            <strong>{status}</strong>
            <span>{lastEvent.text}</span>
          </div>
          <button className="icon-button corner-exit" title="Restore layout" onClick={() => setCornerMode(false)}>
            <Maximize2 size={16} />
          </button>
        </div>
      )}

      <input
        ref={romInputRef}
        type="file"
        accept=".gba,application/octet-stream"
        onChange={(event) => void handleRomFile(event.target.files?.[0])}
        hidden
      />
      <input
        ref={stateInputRef}
        type="file"
        onChange={(event) => void importState(event.target.files?.[0])}
        hidden
      />
    </main>
  );
}
