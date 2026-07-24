/**
 * @vitest-environment jsdom
 *
 * Integration tests for sequential audio playback coordination in
 * ScenarioMessageRenderer.
 *
 * Tests verify:
 *  - No auto-play on mount
 *  - Exclusivity: starting B pauses A
 *  - Instance isolation: two renderer instances are independent
 *  - Auto-advance skips interleaved non-audio items
 *  - Mid-list start advances from that position onward (not from 0)
 *  - Last audio ending triggers no further play
 *  - Rejected play() is caught and does not propagate as unhandledrejection
 *  - Streaming append: new audio appended after mount is played when chain reaches it
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ScenarioMessageRenderer } from "../ScenarioMessageRenderer";
import type { ScenarioMessageSnapshotEvent } from "~/server/scenarios/scenario-event.types";

// ---------------------------------------------------------------------------
// tRPC / TraceMessage mocks (keep renderer lightweight in jsdom)
// ---------------------------------------------------------------------------

vi.mock("~/utils/api", () => ({
  api: {
    storedObjects: {
      headById: {
        useQuery: () => ({ data: undefined }),
      },
    },
  },
}));

vi.mock("../../copilot-kit/TraceMessage", () => ({
  TraceMessage: ({ traceId }: { traceId: string }) => (
    <button data-testid="trace-message" data-trace-id={traceId}>
      View Trace
    </button>
  ),
}));

// ---------------------------------------------------------------------------
// jsdom HTMLMediaElement stubs
//
// jsdom does not implement HTMLMediaElement.play/pause. We stub them on the
// prototype and track which element instance called each method so tests can
// assert "pause was called on audioA" without needing toHaveBeenCalledOn
// (which does not exist in vitest's expect).
//
// Original descriptors are saved before `beforeAll` stubs and restored in
// `afterAll` so the stubs don't bleed into other test files sharing the worker.
// ---------------------------------------------------------------------------

type LwEl = HTMLMediaElement & {
  _lw_paused?: boolean;
  _lw_reject_play?: boolean;
};

/** Elements that called .play() in the current test, in call order. */
const playCalls: LwEl[] = [];
/** Elements that called .pause() in the current test, in call order. */
const pauseCalls: LwEl[] = [];

// Save originals so afterAll can restore them.
const origPlay = Object.getOwnPropertyDescriptor(
  HTMLMediaElement.prototype,
  "play",
);
const origPause = Object.getOwnPropertyDescriptor(
  HTMLMediaElement.prototype,
  "pause",
);
const origPaused = Object.getOwnPropertyDescriptor(
  HTMLMediaElement.prototype,
  "paused",
);

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();

  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    writable: true,
    value: function (this: LwEl) {
      playCalls.push(this);
      if (this._lw_reject_play) {
        return Promise.reject(new Error("NotAllowedError"));
      }
      this._lw_paused = false;
      return Promise.resolve();
    },
  });

  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    writable: true,
    value: function (this: LwEl) {
      pauseCalls.push(this);
      this._lw_paused = true;
    },
  });

  Object.defineProperty(HTMLMediaElement.prototype, "paused", {
    configurable: true,
    get() {
      // All jsdom audio elements start "paused" unless explicitly played.
      return (this as LwEl)._lw_paused !== false;
    },
  });
});

afterAll(() => {
  // Restore original descriptors so stubs don't bleed into other suites.
  if (origPlay) {
    Object.defineProperty(HTMLMediaElement.prototype, "play", origPlay);
  }
  if (origPause) {
    Object.defineProperty(HTMLMediaElement.prototype, "pause", origPause);
  }
  if (origPaused) {
    Object.defineProperty(HTMLMediaElement.prototype, "paused", origPaused);
  }
});

beforeEach(() => {
  playCalls.length = 0;
  pauseCalls.length = 0;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const PROJECT_ID = "proj_test";

/** Build a minimal audio message fixture. */
function audioMsg(
  id: string,
  role: "user" | "assistant" = "user",
): ScenarioMessageSnapshotEvent["messages"][number] {
  return {
    id,
    role,
    content: JSON.stringify([
      {
        type: "input_audio",
        input_audio: { data: "UklGRg==", format: "wav" },
      },
    ]),
  } as ScenarioMessageSnapshotEvent["messages"][number];
}

/** Build a minimal text message fixture. */
function textMsg(
  id: string,
  text = "hello",
  role: "user" | "assistant" = "assistant",
): ScenarioMessageSnapshotEvent["messages"][number] {
  return {
    id,
    role,
    content: text,
  } as ScenarioMessageSnapshotEvent["messages"][number];
}

function renderMessages(
  messages: ScenarioMessageSnapshotEvent["messages"],
  opts?: { container?: HTMLElement },
) {
  return render(
    <Wrapper>
      <ScenarioMessageRenderer
        messages={messages}
        variant="drawer"
        projectId={PROJECT_ID}
      />
    </Wrapper>,
    opts,
  );
}

/** Fire a synthetic event on an HTMLAudioElement. */
function fireAudioEvent(el: HTMLAudioElement, eventType: string) {
  el.dispatchEvent(new Event(eventType, { bubbles: true }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("<ScenarioMessageRenderer/> audio sequential playback", () => {
  afterEach(() => cleanup());

  describe("given a renderer with audio messages", () => {
    describe("when the component mounts", () => {
      /** @scenario No audio plays on initial render without user interaction */
      it("does not call play() on any audio element without user interaction", () => {
        renderMessages([audioMsg("a1"), audioMsg("a2"), audioMsg("a3")]);
        expect(playCalls).toHaveLength(0);
      });
    });
  });

  describe("given two audio messages rendered in the same instance", () => {
    describe("when audio B fires a play event while audio A is playing", () => {
      /** @scenario Starting a new audio pauses any currently playing audio */
      it("pauses audio A", () => {
        renderMessages([audioMsg("a1"), audioMsg("a2")]);

        const [audioA, audioB] = document.querySelectorAll<LwEl>("audio");
        expect(audioA).toBeDefined();
        expect(audioB).toBeDefined();

        // Mark A as "playing"
        audioA!._lw_paused = false;

        // Simulate user starting B — fires the React `onPlay` handler
        fireAudioEvent(audioB!, "play");

        expect(pauseCalls).toHaveLength(1);
        expect(pauseCalls[0]).toBe(audioA);
      });
    });
  });

  describe("given two separate renderer instances", () => {
    describe("when audio plays in the first instance", () => {
      /** @scenario Playing audio in one renderer instance does not pause audio in another instance */
      it("does not pause audio in the second instance", () => {
        // Each instance renders into its own container so DOM queries are
        // unambiguous and the test is self-contained.
        const containerA = document.createElement("div");
        const containerB = document.createElement("div");
        document.body.appendChild(containerA);
        document.body.appendChild(containerB);

        try {
          renderMessages([audioMsg("inst1-a1")], { container: containerA });
          renderMessages([audioMsg("inst2-a1")], { container: containerB });

          const audioInA = containerA.querySelector<LwEl>("audio")!;
          const audioInB = containerB.querySelector<LwEl>("audio")!;

          expect(audioInA).toBeDefined();
          expect(audioInB).toBeDefined();

          // Mark B as playing so pause WOULD be called if instance A's handler
          // incorrectly reached into instance B.
          audioInB._lw_paused = false;

          // Play event fires in instance A's audio element.
          fireAudioEvent(audioInA, "play");

          // Instance A's exclusivity handler must not have paused anything —
          // audioInA is the only element registered in that hook instance and
          // it is the one that just started (so it is skipped).
          expect(pauseCalls).toHaveLength(0);
        } finally {
          document.body.removeChild(containerA);
          document.body.removeChild(containerB);
        }
      });
    });
  });

  describe("given audio followed by a text message followed by another audio", () => {
    describe("when the first audio ends", () => {
      /** @scenario Audio auto-advances to the next audio item when the current one ends */
      /** @scenario Interleaved text items between audio messages are skipped during auto-advance */
      it("calls play() on the second audio item (skipping the text item)", async () => {
        renderMessages([audioMsg("a1"), textMsg("t1"), audioMsg("a2")]);

        const audios = document.querySelectorAll<HTMLAudioElement>("audio");
        expect(audios).toHaveLength(2);
        const [audioA, audioB] = audios;

        playCalls.length = 0;
        fireAudioEvent(audioA!, "ended");

        // Allow microtask queue to flush (play() is async Promise)
        await Promise.resolve();

        expect(playCalls).toHaveLength(1);
        expect(playCalls[0]).toBe(audioB);
      });
    });
  });

  describe("given three audio messages and playback starts at the second", () => {
    describe("when the second audio ends", () => {
      /** @scenario Chain continues from the second audio to the third */
      /** @scenario Starting playback mid-list advances from that position onward */
      it("plays the third audio, not the first", async () => {
        renderMessages([audioMsg("a1"), audioMsg("a2"), audioMsg("a3")]);

        const [, audioB, audioC] = document.querySelectorAll<HTMLAudioElement>("audio");

        playCalls.length = 0;
        fireAudioEvent(audioB!, "ended");

        await Promise.resolve();

        expect(playCalls).toHaveLength(1);
        expect(playCalls[0]).toBe(audioC);
      });
    });
  });

  describe("given a single audio message", () => {
    describe("when that audio ends", () => {
      /** @scenario Chain stops at the last audio message */
      /** @scenario The last audio ending does not trigger any further play */
      it("does not call play() again (chain stops at last item)", async () => {
        renderMessages([audioMsg("a1")]);
        const [audio] = document.querySelectorAll<HTMLAudioElement>("audio");

        playCalls.length = 0;
        fireAudioEvent(audio!, "ended");

        await Promise.resolve();
        expect(playCalls).toHaveLength(0);
      });

      it("does not throw an unhandled rejection", async () => {
        const unhandled = vi.fn();
        window.addEventListener("unhandledrejection", unhandled);

        try {
          renderMessages([audioMsg("a1")]);
          const [audio] = document.querySelectorAll<HTMLAudioElement>("audio");

          playCalls.length = 0;
          fireAudioEvent(audio!, "ended");

          await Promise.resolve();
          expect(unhandled).not.toHaveBeenCalled();
        } finally {
          window.removeEventListener("unhandledrejection", unhandled);
        }
      });
    });
  });

  describe("given three audio messages and the second audio's play() rejects", () => {
    describe("when the first audio ends", () => {
      /** @scenario A failed play() during auto-advance does not throw an unhandled rejection */
      it("does not throw an unhandled rejection", async () => {
        const unhandled = vi.fn();
        window.addEventListener("unhandledrejection", unhandled);

        try {
          renderMessages([audioMsg("a1"), audioMsg("a2"), audioMsg("a3")]);
          const [, audioB] = document.querySelectorAll<LwEl>("audio");

          // Mark audioB to reject on play
          audioB!._lw_reject_play = true;

          const [audioA] = document.querySelectorAll<HTMLAudioElement>("audio");
          playCalls.length = 0;
          fireAudioEvent(audioA!, "ended");

          // Flush microtask queue — the rejection must be caught internally
          await Promise.resolve();
          await Promise.resolve();

          expect(unhandled).not.toHaveBeenCalled();
        } finally {
          window.removeEventListener("unhandledrejection", unhandled);
        }
      });

      it("does not call play() on any audio after the rejected one", async () => {
        // 3-audio fixture: A → B(rejects) → C. When A ends, B is attempted.
        // B rejects. C must never be played.
        renderMessages([audioMsg("a1"), audioMsg("a2"), audioMsg("a3")]);
        const [audioA, audioB] = document.querySelectorAll<LwEl>("audio");

        // Mark audioB to reject on play
        audioB!._lw_reject_play = true;

        playCalls.length = 0;
        fireAudioEvent(audioA!, "ended");

        await Promise.resolve();
        await Promise.resolve();

        // Only one play() call total — on audioB (which rejected).
        // audioC must never have been attempted.
        expect(playCalls).toHaveLength(1);
        expect(playCalls[0]).toBe(audioB);
      });
    });
  });

  describe("given two audio messages already rendered", () => {
    describe("when a third audio message is appended via streaming and the second audio ends", () => {
      it("plays the appended (third) audio", async () => {
        // Initial render: two audio items
        const { rerender } = renderMessages([audioMsg("a1"), audioMsg("a2")]);

        // Streaming append: re-render with a third audio message added
        rerender(
          <ChakraProvider value={defaultSystem}>
            <ScenarioMessageRenderer
              messages={[audioMsg("a1"), audioMsg("a2"), audioMsg("a3")]}
              variant="drawer"
              projectId={PROJECT_ID}
            />
          </ChakraProvider>,
        );

        const [, audioB, audioC] = document.querySelectorAll<HTMLAudioElement>("audio");
        expect(audioC).toBeDefined();

        playCalls.length = 0;
        fireAudioEvent(audioB!, "ended");

        await Promise.resolve();

        // The hook must have picked up the appended id from the updated
        // orderedIds list — not a stale index captured at mount time.
        expect(playCalls).toHaveLength(1);
        expect(playCalls[0]).toBe(audioC);
      });
    });
  });
});
