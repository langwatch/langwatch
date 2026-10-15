import type * as Shaders from "@paper-design/shaders";
import { afterEach, describe, expect, it, vi } from "vitest";

const mounted = vi.hoisted(() => [] as unknown[][]);

vi.mock("@paper-design/shaders", async (importOriginal) => ({
  ...(await importOriginal<typeof Shaders>()),
  ShaderMount: class {
    constructor(...args: unknown[]) {
      mounted.push(args);
    }
    dispose(): void {}
  },
}));

const { mountAmbientShader, stopWhenFramesAreSlow } = await import("../ambient-ground-shader");

describe("the ambient ground's live shader", () => {
  afterEach(() => {
    mounted.length = 0;
    vi.unstubAllGlobals();
  });

  describe("given a browser that only renders WebGL in software", () => {
    it("asks for a WebGL context that refuses a major performance caveat", async () => {
      vi.stubGlobal("requestAnimationFrame", () => 0);
      await mountAmbientShader({ element: {} as HTMLElement, mode: "light" });

      expect(mounted[0]?.[3]).toEqual({ failIfMajorPerformanceCaveat: true });
    });
  });

  describe("given frames drawn at the given gaps", () => {
    function framesAt(gaps: number[]) {
      const queued: FrameRequestCallback[] = [];
      let now = 0;
      const stopped = vi.fn();
      stopWhenFramesAreSlow({ stop: stopped, requestFrame: (tick) => queued.push(tick) });
      for (const gap of [0, ...gaps]) {
        now += gap;
        queued.shift()?.(now);
      }
      return { stopped, waiting: queued.length };
    }

    /** @scenario "The boot screen keeps its still ground where WebGL is slow" */
    it("stops the live ground after three slow frames in a row", () => {
      const { stopped, waiting } = framesAt([350, 340, 360]);

      expect(stopped).toHaveBeenCalledOnce();
      expect(waiting).toBe(0);
    });

    it("lets one slow frame pass, as a busy load makes", () => {
      expect(framesAt([16, 600, 16, 17, 400, 16]).stopped).not.toHaveBeenCalled();
    });

    it("stops watching once the frames have been fast for a while", () => {
      const { stopped, waiting } = framesAt(Array.from({ length: 60 }, () => 16));

      expect(stopped).not.toHaveBeenCalled();
      expect(waiting).toBe(0);
    });
  });
});
