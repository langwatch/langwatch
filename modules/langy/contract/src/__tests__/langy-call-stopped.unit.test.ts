/**
 * The words that mark a stopped call are one constant, pinned to the worker's own text.
 * @see specs/langy/langy-stop-and-resume.feature
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isLangyCallStoppedText, LANGY_CALL_STOPPED_PREFIX } from "../langy-call-stopped.ts";

/** Walks to the workspace root, so moving this file never leaves a counted ../ stale. */
function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("no workspace root above this test");
    dir = parent;
  }
  return dir;
}

const WORKER_SOURCE = path.join(repoRoot(), "services/langyworker/src/tools/local-workspace.ts");

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

  describe("given the same words in another case", () => {
    it("is still read as a stop", () => {
      expect(
        isLangyCallStoppedText("cancelled: The turn was stopped, so the command did not finish."),
      ).toBe(true);
    });
  });

  describe("given text of an ordinary failure", () => {
    it("is not read as a stop", () => {
      expect(isLangyCallStoppedText("The question could not be shown.")).toBe(false);
      expect(isLangyCallStoppedText(undefined)).toBe(false);
    });
  });
});
