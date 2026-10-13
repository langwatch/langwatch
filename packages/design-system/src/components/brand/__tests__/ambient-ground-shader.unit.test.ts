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

const { mountAmbientShader } = await import("../ambient-ground-shader");

describe("the ambient ground's live shader", () => {
  afterEach(() => {
    mounted.length = 0;
  });

  describe("given a browser that only renders WebGL in software", () => {
    /** @scenario "The boot screen keeps its still ground where WebGL is slow" */
    it("asks for a WebGL context that refuses a major performance caveat", async () => {
      await mountAmbientShader({ element: {} as HTMLElement, mode: "light" });

      expect(mounted[0]?.[3]).toEqual({ failIfMajorPerformanceCaveat: true });
    });
  });
});
