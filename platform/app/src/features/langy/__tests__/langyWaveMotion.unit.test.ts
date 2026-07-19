/**
 * @vitest-environment node
 *
 * The fold moves with LANGY'S BEHAVIOUR, never the cursor — and its motion is
 * a quiet status channel, not a spectacle. These tests pin the vocabulary
 * (which state produces which motion character), the truth of the derivation
 * (it reads the same wire signals as the thinking line, so it can't perform
 * work that isn't happening), and the no-pop guarantee (one smoothed vector,
 * rising fast enough to be legible, falling slowly enough to ease out).
 *
 * Spec: specs/langy/langy-panel-fold-motion.feature
 */
import { describe, expect, it } from "vitest";
import {
  deriveWaveActivity,
  isErrorTransition,
  isSuccessTransition,
  isWakeTransition,
  restingWaveMotion,
  stepWaveMotion,
  WAVE_MOTION_TARGETS,
  type LangyWaveActivity,
  type LangyWaveMotion,
} from "../logic/langyWaveMotion";

const assistant = (parts: unknown[]) => ({
  role: "assistant",
  parts: parts as never,
});
const user = { role: "user", parts: [{ type: "text", text: "hi" }] };

const derive = (
  overrides: Partial<Parameters<typeof deriveWaveActivity>[0]> = {},
) =>
  deriveWaveActivity({
    turnInFlight: false,
    isSettling: false,
    hasLiveReasoning: false,
    messages: [user],
    ...overrides,
  });

describe("deriveWaveActivity", () => {
  describe("given no turn in flight", () => {
    it("rests idle", () => {
      expect(derive()).toBe("idle");
    });
  });

  describe("given a turn in flight", () => {
    describe("when nothing has reached the wire", () => {
      it("waits — it never claims work that isn't happening", () => {
        expect(
          derive({ turnInFlight: true, messages: [user, assistant([])] }),
        ).toBe("waiting");
      });
    });

    describe("when reasoning is streaming", () => {
      it("thinks", () => {
        expect(
          derive({
            turnInFlight: true,
            hasLiveReasoning: true,
            messages: [user, assistant([])],
          }),
        ).toBe("thinking");
      });
    });

    describe("when tokens are arriving", () => {
      it("streams", () => {
        expect(
          derive({
            turnInFlight: true,
            messages: [user, assistant([{ type: "text", text: "Here's" }])],
          }),
        ).toBe("streaming");
      });

      it("prefers streaming over thinking once prose lands", () => {
        expect(
          derive({
            turnInFlight: true,
            hasLiveReasoning: true,
            messages: [user, assistant([{ type: "text", text: "Here's" }])],
          }),
        ).toBe("streaming");
      });
    });

    describe("when a tool is running", () => {
      const runningToolPart = {
        type: "tool-bash",
        state: "input-available",
        input: { command: "ls" },
      };

      it("pulses on the tool, even mid-prose", () => {
        expect(
          derive({
            turnInFlight: true,
            messages: [
              user,
              assistant([
                { type: "text", text: "Let me check" },
                runningToolPart,
              ]),
            ],
          }),
        ).toBe("tool");
      });

      it("returns to streaming once the tool settles", () => {
        expect(
          derive({
            turnInFlight: true,
            messages: [
              user,
              assistant([
                { type: "text", text: "Let me check" },
                { ...runningToolPart, state: "output-available" },
              ]),
            ],
          }),
        ).toBe("streaming");
      });
    });
  });

  describe("given a failed or recovering turn", () => {
    it("settles, whatever else is on the wire", () => {
      expect(
        derive({
          turnInFlight: true,
          isSettling: true,
          messages: [user, assistant([{ type: "text", text: "partial" }])],
        }),
      ).toBe("settling");
    });
  });
});

describe("WAVE_MOTION_TARGETS", () => {
  it("keeps streaming the most energetic and fastest state", () => {
    const others = (
      Object.keys(WAVE_MOTION_TARGETS) as LangyWaveActivity[]
    ).filter((s) => s !== "streaming");
    for (const state of others) {
      expect(WAVE_MOTION_TARGETS.streaming.energy).toBeGreaterThan(
        WAVE_MOTION_TARGETS[state].energy,
      );
      expect(WAVE_MOTION_TARGETS.streaming.drift).toBeGreaterThan(
        WAVE_MOTION_TARGETS[state].drift,
      );
    }
  });

  it("makes thinking a slow deep swell — slower and flatter than streaming", () => {
    expect(WAVE_MOTION_TARGETS.thinking.drift).toBeLessThan(
      WAVE_MOTION_TARGETS.streaming.drift,
    );
    expect(WAVE_MOTION_TARGETS.thinking.flutter).toBeLessThan(
      WAVE_MOTION_TARGETS.streaming.flutter,
    );
  });

  it("gives ONLY the tool state a pulse", () => {
    for (const [state, target] of Object.entries(WAVE_MOTION_TARGETS)) {
      if (state === "tool") expect(target.pulse).toBeGreaterThan(0);
      else expect(target.pulse).toBe(0);
    }
  });

  it("keeps the settling state the stillest", () => {
    const others = (
      Object.keys(WAVE_MOTION_TARGETS) as LangyWaveActivity[]
    ).filter((s) => s !== "settling");
    for (const state of others) {
      expect(WAVE_MOTION_TARGETS.settling.energy).toBeLessThan(
        WAVE_MOTION_TARGETS[state].energy,
      );
    }
  });

  it("keeps every amplitude low — the complaint was distraction", () => {
    for (const target of Object.values(WAVE_MOTION_TARGETS)) {
      expect(target.energy).toBeLessThanOrEqual(1);
      expect(target.energy).toBeGreaterThanOrEqual(0);
    }
    // Idle is the permanent look: it must sit well under half of full energy.
    expect(WAVE_MOTION_TARGETS.idle.energy).toBeLessThan(0.5);
  });
});

/** Run the smoother at 60fps for a given duration. */
function run(
  from: LangyWaveMotion,
  activity: LangyWaveActivity,
  seconds: number,
): LangyWaveMotion {
  let motion = from;
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    motion = stepWaveMotion({ current: motion, activity, dt });
  }
  return motion;
}

describe("stepWaveMotion", () => {
  describe("when a turn starts streaming", () => {
    it("reaches most of the streaming energy within a second", () => {
      const motion = run(restingWaveMotion(), "streaming", 1);
      const target = WAVE_MOTION_TARGETS.streaming.energy;
      expect(motion.energy).toBeGreaterThan(target * 0.85);
      expect(motion.energy).toBeLessThanOrEqual(target);
    });

    it("never overshoots the target", () => {
      let motion = restingWaveMotion();
      const dt = 1 / 60;
      for (let t = 0; t < 5; t += dt) {
        motion = stepWaveMotion({ current: motion, activity: "streaming", dt });
        expect(motion.energy).toBeLessThanOrEqual(
          WAVE_MOTION_TARGETS.streaming.energy,
        );
      }
    });
  });

  describe("when the turn ends", () => {
    it("eases back toward idle over a couple of seconds, never snapping", () => {
      const busy = { ...WAVE_MOTION_TARGETS.streaming };
      // After a quarter second it is still visibly above idle — no snap.
      const shortly = run(busy, "idle", 0.25);
      expect(shortly.energy).toBeGreaterThan(
        WAVE_MOTION_TARGETS.idle.energy + 0.1,
      );
      // By two seconds it has, for the eye, settled.
      const settled = run(busy, "idle", 2);
      expect(settled.energy).toBeLessThan(
        WAVE_MOTION_TARGETS.idle.energy + 0.05,
      );
    });
  });

  describe("when states flip rapidly (tool → stream → tool)", () => {
    it("moves the character params continuously, one small step at a time", () => {
      let motion = { ...WAVE_MOTION_TARGETS.tool };
      const dt = 1 / 60;
      let previous = motion;
      const flips: LangyWaveActivity[] = ["streaming", "tool", "streaming"];
      for (const activity of flips) {
        for (let t = 0; t < 0.2; t += dt) {
          motion = stepWaveMotion({ current: motion, activity, dt });
          // Per-frame movement stays a whisper — no visible jumps.
          expect(Math.abs(motion.flutter - previous.flutter)).toBeLessThan(
            0.05,
          );
          expect(Math.abs(motion.pulse - previous.pulse)).toBeLessThan(0.05);
          previous = motion;
        }
      }
    });
  });
});

describe("isWakeTransition", () => {
  it("fires the ripple only when a resting fold starts working", () => {
    expect(isWakeTransition("idle", "waiting")).toBe(true);
    expect(isWakeTransition("idle", "streaming")).toBe(true);
    expect(isWakeTransition("settling", "waiting")).toBe(true);
  });

  it("never ripples on working-to-working flips or on easing back to rest", () => {
    expect(isWakeTransition("tool", "streaming")).toBe(false);
    expect(isWakeTransition("streaming", "tool")).toBe(false);
    expect(isWakeTransition("streaming", "idle")).toBe(false);
    expect(isWakeTransition("waiting", "thinking")).toBe(false);
    expect(isWakeTransition("idle", "settling")).toBe(false);
  });
});

describe("isErrorTransition", () => {
  it("shakes only on ENTERING settling from a non-settling state", () => {
    expect(isErrorTransition("streaming", "settling")).toBe(true);
    expect(isErrorTransition("idle", "settling")).toBe(true);
    expect(isErrorTransition("tool", "settling")).toBe(true);
  });

  it("never re-shakes while already settling, nor on leaving it", () => {
    expect(isErrorTransition("settling", "settling")).toBe(false);
    expect(isErrorTransition("settling", "idle")).toBe(false);
    expect(isErrorTransition("streaming", "idle")).toBe(false);
  });
});

describe("isSuccessTransition", () => {
  it("wags only when a working turn resolves cleanly to idle", () => {
    expect(isSuccessTransition("streaming", "idle")).toBe(true);
    expect(isSuccessTransition("tool", "idle")).toBe(true);
    expect(isSuccessTransition("thinking", "idle")).toBe(true);
    expect(isSuccessTransition("waiting", "idle")).toBe(true);
  });

  it("never wags on a failed wind-down or on non-working origins", () => {
    // The shake already spoke for a failed turn — settling→idle is not a win.
    expect(isSuccessTransition("settling", "idle")).toBe(false);
    expect(isSuccessTransition("idle", "idle")).toBe(false);
    // Entering a working state is not a success.
    expect(isSuccessTransition("streaming", "tool")).toBe(false);
  });
});
