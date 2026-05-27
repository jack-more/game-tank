import type { AgentProfile, ProfileEvent } from "./types";

const META_KEY = "pokesim.profiles.v1";
const DB_NAME = "pokesim.blobs.v1";
const DB_VERSION = 1;
const STORE = "blobs";

const starterEvents: ProfileEvent[] = [
  {
    id: crypto.randomUUID(),
    at: Date.now(),
    tone: "system",
    text: "Tank prepared. Awaiting ROM and goal.",
  },
];

export function createProfile(index = 1): AgentProfile {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    userName: "Local user",
    agentName: `Agent ${index}`,
    gameName: "GBA session",
    goal: "Grind safely. Stop before any irreversible story progress.",
    stopRules: "Do not pass a gym or major story gate without asking.\nPause before evolution or irreversible item use.",
    goalQueue: [],
    liveInstruction: "",
    mode: "standby",
    paceMs: 1100,
    guardrailArmed: true,
    ticks: 0,
    updatedAt: now,
    createdAt: now,
    saves: [],
    events: starterEvents,
  };
}

export function loadProfiles(): AgentProfile[] {
  const raw = localStorage.getItem(META_KEY);
  if (!raw) return [createProfile()];

  try {
    const profiles = JSON.parse(raw) as AgentProfile[];
    return profiles.length
      ? profiles.map((profile) => ({
          ...profile,
          stopRules:
            profile.stopRules ??
            "Do not pass a gym or major story gate without asking.\nPause before evolution or irreversible item use.",
          goalQueue: profile.goalQueue ?? [],
          liveInstruction: profile.liveInstruction ?? "",
        }))
      : [createProfile()];
  } catch {
    return [createProfile()];
  }
}

export function saveProfiles(profiles: AgentProfile[]) {
  localStorage.setItem(META_KEY, JSON.stringify(profiles));
}

export function addProfileEvent(
  profile: AgentProfile,
  tone: ProfileEvent["tone"],
  text: string,
): AgentProfile {
  const event: ProfileEvent = {
    id: crypto.randomUUID(),
    at: Date.now(),
    tone,
    text,
  };

  return {
    ...profile,
    updatedAt: Date.now(),
    events: [event, ...profile.events].slice(0, 48),
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putBlob(key: string, blob: Blob) {
  const db = await openDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
}

export async function getBlob(key?: string): Promise<Blob | undefined> {
  if (!key) return undefined;

  const db = await openDb();

  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error);
  });

  db.close();
  return blob;
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
