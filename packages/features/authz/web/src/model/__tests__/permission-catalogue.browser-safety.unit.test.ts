/**
 * The role editor's permission checkboxes read `permission-catalogue.ts`
 * directly in the browser bundle. If that module's import graph ever pulled
 * in a Node-only package that runs something at import time (a logger, a
 * metrics client, a DB driver), the chunk would die with "process is not
 * defined" before the app mounts — and none of typecheck, lint, or the unit
 * suite would catch it, because none of them load a browser.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MODEL_DIR = join(import.meta.dirname, "..");

/** Packages known to run something at import time. */
const RUNS_AT_IMPORT = ["prom-client", "ioredis", "pg", "@prisma/client"];

function importsOf(file: string): string[] {
  const source = readFileSync(join(MODEL_DIR, file), "utf8");
  return [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]!);
}

describe("the permission vocabulary the UI reads", () => {
  /** @scenario "The permission vocabulary the UI reads pulls in no server code" */
  it("pulls in no server code", () => {
    for (const file of ["permission-catalogue.ts", "permission-matrix.ts"]) {
      expect(importsOf(file).filter((spec) => RUNS_AT_IMPORT.includes(spec))).toEqual([]);
      expect(importsOf(file).some((spec) => spec.startsWith("@langwatch/authz-server"))).toBe(
        false,
      );
    }
  });
});
