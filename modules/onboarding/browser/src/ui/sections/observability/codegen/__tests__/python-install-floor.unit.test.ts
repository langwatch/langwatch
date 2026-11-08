import { describe, expect, it } from "vitest";

import { PROMPT_TRACING } from "../../../../../model/code-prompts.ts";
import { registry } from "../registry.tsx";

/**
 * 1.3.0 is the first Python release with setup and connect_agent. A bare langwatch lets pip walk
 * back to a release without them on an interpreter newer than the SDK supports.
 */
const FLOORED = '"langwatch>=1.3.0"';
const BARE = /(?:pip install|uv add) langwatch(?![-\w>=])/;

describe("the Python install lines", () => {
  describe("when the onboarding registry is read", () => {
    const installs = registry.flatMap((spec) =>
      spec.install?.python ? [spec.install.python.pip, spec.install.python.uv] : [],
    );

    it("asks every pip and uv install for 1.3.0 or newer", () => {
      expect(installs.length).toBeGreaterThan(10);
      expect(installs.filter((install) => !install.includes(FLOORED))).toEqual([]);
    });
  });

  describe("when the tracing prompt is read", () => {
    it("asks for 1.3.0 or newer and never for a bare langwatch", () => {
      expect(PROMPT_TRACING).toContain(`pip install ${FLOORED}`);
      expect(PROMPT_TRACING).toContain(`uv add ${FLOORED}`);
      expect(PROMPT_TRACING).not.toMatch(BARE);
    });
  });
});
