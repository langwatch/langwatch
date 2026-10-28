/**
 * The words that mark a stopped call are one constant, pinned to the worker's own text.
 * @see specs/langy/langy-stop-and-resume.feature
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isLangyCallStoppedText, LANGY_CALL_STOPPED_PREFIX } from "../langy-call-stopped.ts";

const WORKER_SOURCE = fileURLToPath(
  new URL("../../../../../services/langyworker/src/tools/local-workspace.ts", import.meta.url),
);

describe("the stopped-call marker", () => {
  describe("given the worker's own cancelled text", () => {
    /** @scenario A question card I stopped reads as closed, not as failed */
    it("starts with the shared prefix, so rewording either side fails here", () => {
      const source = readFileSync(WORKER_SOURCE, "utf8");
      const pushback = /export const CANCELLED_PUSHBACK =\s*"([^"]+)"/.exec(source)?.[1];

      expect(pushback).toBeDefined();
      expect(pushback!.startsWith(LANGY_CALL_STOPPED_PREFIX)).toBe(true);
      expect(isLangyCallStoppedText(pushback)).toBe(true);
    });
  });

  describe("given text of an ordinary failure", () => {
    it("is not read as a stop", () => {
      expect(isLangyCallStoppedText("The question could not be shown.")).toBe(false);
      expect(isLangyCallStoppedText(undefined)).toBe(false);
    });
  });
});
