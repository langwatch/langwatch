import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { Pairing, readReplay } from "../pairing";
import type { CaptureMessage, Plan } from "../protocol";
import { shellBroken } from "../shell";

const capture = (overrides: Partial<CaptureMessage>): CaptureMessage => ({
  type: "capture",
  kind: "route",
  key: "/{slug}",
  index: 0,
  label: "/{slug}",
  side: "candidate",
  url: "http://app/x",
  screenshot: "/shots/x.png",
  consoleErrors: [],
  failedRequests: [],
  notFound: false,
  blank: false,
  ariaSnapshot: "",
  error: "",
  durationMs: 10,
  ...overrides,
});

const plan = (overrides: Partial<Plan>): Plan => ({
  viewport: { width: 10, height: 10 },
  settle: { quietMillis: 1, deadlineMillis: 1 },
  sides: [],
  outDir: "/out",
  slug: "p",
  routes: [],
  flows: [],
  credential: { projectKey: "", email: "", password: "", slug: "p" },
  ...overrides,
});

describe("Feature: visualdiff fails fast on a broken candidate", () => {
  describe("given the candidate's first three routes each throw on mount", () => {
    /** @scenario A candidate whose shell does not render stops the run within its first routes */
    it("names every route and why it did not render", () => {
      const broken = shellBroken({
        probes: ["/a", "/b", "/c"].map((key) => ({
          capture: capture({ key, consoleErrors: ["pageerror: boom"] }),
          blank: false,
        })),
      });
      expect(broken).toBe("/a: pageerror: boom; /b: pageerror: boom; /c: pageerror: boom");
    });
  });

  describe("given one of the first three routes renders", () => {
    it("does not stop the run", () => {
      const probes = [
        { capture: capture({ key: "/a" }), blank: true },
        { capture: capture({ key: "/b" }), blank: false },
        { capture: capture({ key: "/c", error: "timeout" }), blank: false },
      ];
      expect(shellBroken({ probes })).toBe("");
    });
  });

  describe("given fewer than three routes so far", () => {
    it("does not decide yet", () => {
      expect(shellBroken({ probes: [{ capture: capture({}), blank: true }] })).toBe("");
    });
  });
});

describe("Feature: visualdiff reuses a cached baseline", () => {
  describe("given a replayed base and a live candidate", () => {
    /** @scenario Each screen is diffed the moment both sides of it exist */
    it("diffs a screen as soon as its second side arrives", () => {
      const seen: string[] = [];
      const pairing = new Pairing(plan({}), ({ base, candidate }) => {
        seen.push(`${base}|${candidate}`);
        return { ratio: 0.5, pixels: 1, width: 1, height: 1, sizeMismatch: false };
      });
      expect(pairing.add(capture({ side: "base", screenshot: "/b.png" }))).toBeNull();
      const diff = pairing.add(capture({ side: "candidate", screenshot: "/c.png" }));
      expect(diff?.ratio).toBe(0.5);
      expect(seen).toEqual(["/b.png|/c.png"]);
    });
  });

  describe("given a baseline recorded for more routes than the plan asks for", () => {
    /** @scenario A recapture replays only the routes it names from the baseline */
    it("replays only the planned routes and flows, as the named side", () => {
      const dir = mkdtempSync(join(tmpdir(), "vd-replay-"));
      const file = join(dir, "captures.jsonl");
      const lines = [
        capture({ key: "/a", side: "base" }),
        capture({ key: "/b", side: "base" }),
        capture({ kind: "flow", key: "prompt-create", index: 1, side: "base" }),
      ];
      writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n"));
      const replayed = readReplay({
        file,
        plan: plan({ routes: ["/b"], flows: [{ id: "prompt-create", title: "", steps: [] }] }),
        side: "base",
      });
      expect(replayed.map((entry) => entry.key)).toEqual(["/b", "prompt-create"]);
    });
  });
});
