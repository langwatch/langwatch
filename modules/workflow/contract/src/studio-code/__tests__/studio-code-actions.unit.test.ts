/**
 * The Studio code editor's action table: what exists, what each needs, and what the schema refuses
 * before anything reaches the editor. Spec: specs/langy/langy-studio-code-blocks.feature.
 */
import { describe, expect, it } from "vitest";

import {
  STUDIO_CODE_ACTION_KINDS,
  STUDIO_CODE_ACTIONS,
  STUDIO_CODE_MAX_BYTES,
  studioCodeProposePayloadSchema,
} from "../studio-code-actions.ts";

describe("given the studio code action manifest", () => {
  /** @scenario "Every studio.code action names its payload schema and permission" */
  it("gates reading on workflows:view, proposing on workflows:manage, and declares no backend", () => {
    expect(STUDIO_CODE_ACTION_KINDS).toEqual(["studio.code.read", "studio.code.propose"]);
    expect(STUDIO_CODE_ACTIONS["studio.code.read"].requiredPermission).toBe("workflows:view");
    expect(STUDIO_CODE_ACTIONS["studio.code.propose"].requiredPermission).toBe("workflows:manage");
    for (const kind of STUDIO_CODE_ACTION_KINDS) {
      expect(typeof STUDIO_CODE_ACTIONS[kind].payloadSchema.safeParse).toBe("function");
      expect("backend" in STUDIO_CODE_ACTIONS[kind]).toBe(false);
    }
  });

  describe("when studio.code.propose is given code at the cap", () => {
    it("accepts it", () => {
      const parsed = studioCodeProposePayloadSchema.safeParse({
        code: "a".repeat(STUDIO_CODE_MAX_BYTES),
        summary: "Fills the cap",
      });

      expect(parsed.success).toBe(true);
    });
  });

  describe("when studio.code.propose is given more than 100 KB of code", () => {
    /** @scenario "A proposal over the code size cap is refused by the schema" */
    it("refuses the payload", () => {
      const parsed = studioCodeProposePayloadSchema.safeParse({
        code: "a".repeat(STUDIO_CODE_MAX_BYTES + 1),
        summary: "Too big",
      });

      expect(parsed.success).toBe(false);
    });

    it("measures multi-byte characters by their encoded size", () => {
      const parsed = studioCodeProposePayloadSchema.safeParse({
        code: "é".repeat(STUDIO_CODE_MAX_BYTES / 2 + 1),
        summary: "Under the cap in characters, over it in bytes",
      });

      expect(parsed.success).toBe(false);
    });
  });

  describe("when studio.code.propose carries anything but code and a summary", () => {
    /** @scenario "A proposal that tries to change anything but the code is refused by the schema" */
    it.each([
      ["a language", { language: "python" }],
      ["inputs", { inputs: [{ identifier: "question", type: "str" }] }],
      ["outputs", { outputs: [{ identifier: "answer", type: "str" }] }],
      ["a save flag", { save: true }],
      ["a run flag", { run: true }],
    ])("refuses %s", (_name, extra) => {
      const parsed = studioCodeProposePayloadSchema.safeParse({
        code: "export default async function () { return {}; }",
        summary: "Adds a field",
        ...extra,
      });

      expect(parsed.success).toBe(false);
    });

    it("refuses a proposal with no summary", () => {
      const parsed = studioCodeProposePayloadSchema.safeParse({ code: "x = 1", summary: "  " });

      expect(parsed.success).toBe(false);
    });
  });
});
