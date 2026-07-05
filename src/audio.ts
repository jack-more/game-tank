const contexts: AudioContext[] = [];

declare global {
  interface Window {
    __gtAudioContexts?: AudioContext[];
  }
}

if (typeof window !== "undefined") {
  window.__gtAudioContexts = contexts;
}

/**
 * Browsers suspend AudioContexts created without a user gesture, and some
 * emulator cores stall their timing loop on suspended audio. Track every
 * context the emulator creates and resume them on the first real gesture.
 */
export function installAudioUnlocker() {
  const globals = window as unknown as Record<string, unknown>;

  for (const name of ["AudioContext", "webkitAudioContext"]) {
    const Original = globals[name] as typeof AudioContext | undefined;
    if (!Original) continue;

    globals[name] = class extends Original {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args);
        contexts.push(this);
      }
    };
  }

  window.addEventListener("pointerdown", resumeAllAudio, true);
  window.addEventListener("keydown", resumeAllAudio, true);
}

export function resumeAllAudio() {
  for (const context of contexts) {
    if (context.state === "suspended") void context.resume();
  }
}

export function hasSuspendedAudio() {
  return contexts.some((context) => context.state === "suspended");
}
