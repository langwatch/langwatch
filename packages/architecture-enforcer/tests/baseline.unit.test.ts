/**
 * @vitest-environment node
 * @see specs/lint-baselines.feature
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Temporal } from "@langwatch/time";
import {
  BASELINE_VERSION,
  baselinePath,
  collectBaseline,
  emptyBaselineRows,
  expiredRows,
  formatBaseline,
  liveKeys,
  readBaseline,
  shrinkCheck,
  staleRows,
  type BaselineEntry,
  type BaselinePolicy,
} from "../src/index.ts";

const NOW = Temporal.Instant.from("2026-09-08T00:00:00Z");

const policy: BaselinePolicy = {
  id: "example",
  file: "example-baseline.json",
  label: "Example baseline",
  keyRule: "A key is `<kind>|<path>`.",
  enforceExpiry: true,
  refuseEmpty: true,
  expired: (entry) => ({ message: `Example row ${entry.key} expired ${entry.expires}.` }),
  stale: (entry) => ({ message: `Example row ${entry.key} matches nothing.` }),
  growth: {
    added: (entry) => ({ message: `Example baseline cannot add ${entry.key}.` }),
    raised: (entry) => ({ message: `Example baseline cannot raise ${entry.key}.` }),
    postponed: (entry) => ({ message: `Example baseline cannot postpone ${entry.key}.` }),
  },
};

const shrinkOnly: BaselinePolicy = { ...policy, enforceExpiry: false, refuseEmpty: false };

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "architecture-enforcer-baseline-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(document: unknown): string {
  const file = baselinePath({ root, policy });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(document));

  return file;
}

function row(key: string, extra: Partial<BaselineEntry> = {}): BaselineEntry {
  return { key, measured: "2026-09-01", ...extra };
}

function document(entries: readonly BaselineEntry[]): unknown {
  return { version: BASELINE_VERSION, policy: policy.id, entries };
}

describe("given a baseline file", () => {
  describe("when the file is read", () => {
    /** @scenario "Every ratchet reads through one shape" */
    it("accepts a sorted, dated, deduplicated file and returns its rows", () => {
      const file = write(document([row("a|one"), row("b|two", { expires: "2099-01-01" })]));
      const read = readBaseline({ policy, file });

      expect(read.violations).toEqual([]);
      expect(read.entries.map((entry) => entry.key)).toEqual(["a|one", "b|two"]);
    });

    /** @scenario "An out-of-order or duplicated file is refused before it is read" */
    it("refuses rows that are out of code-unit order", () => {
      const file = write(document([row("b|two"), row("a|one")]));

      expect(readBaseline({ policy, file }).violations).toMatchObject([
        { policy: "example-baseline", message: "Example baseline entries must be sorted by key." },
      ]);
    });

    /** @scenario "An out-of-order or duplicated file is refused before it is read" */
    it("refuses the same key twice", () => {
      const file = write(document([row("a|one"), row("a|one")]));

      expect(readBaseline({ policy, file }).violations).toMatchObject([
        { policy: "example-baseline", message: "Example baseline lists a|one more than once." },
      ]);
    });

    /** @scenario "A file that is not the one shape is refused by name" */
    it("refuses a row whose measured date is not a date", () => {
      const file = write(document([{ key: "a|one", measured: "yesterday" }]));

      expect(readBaseline({ policy, file }).violations).toMatchObject([
        { message: expect.stringContaining(`must be version ${BASELINE_VERSION}`) },
      ]);
    });

    /** @scenario "A file that is not the one shape is refused by name" */
    it("refuses a file whose policy name is another policy's", () => {
      const file = write({ version: BASELINE_VERSION, policy: "other", entries: [] });

      expect(readBaseline({ policy, file }).violations).toMatchObject([
        { message: expect.stringContaining('names policy "other"') },
      ]);
    });

    it("treats an absent file as no rows and no refusal", () => {
      const read = readBaseline({ policy, file: join(root, "absent.json") });

      expect(read).toEqual({ exists: false, entries: [], violations: [] });
    });

    /** @scenario "An emptied ratchet is deleted, not kept" */
    it("refuses a file that has run out of rows", () => {
      const file = write(document([]));
      const read = readBaseline({ policy, file });

      expect(emptyBaselineRows({ read, policy, file })).toMatchObject([
        { message: expect.stringContaining("must be deleted rather than kept") },
      ]);
    });
  });

  describe("when the rows are compared with what the policy found", () => {
    /** @scenario "A row no live finding matches is reported as stale" */
    it("reports a row nothing matches, and marks it stale for the report", () => {
      const rows = [row("a|one"), row("b|two")];

      expect(
        staleRows({ entries: rows, found: new Set(["a|one"]), policy, file: "f.json", now: NOW }),
      ).toEqual([
        {
          policy: "example-baseline",
          file: "f.json",
          message: "Example row b|two matches nothing.",
          allowed: void 0,
          stale: true,
        },
      ]);
    });

    /** @scenario "An expired row is refused where the policy enforces its date" */
    it("refuses an expired row where the policy enforces the date, and not where it does not", () => {
      const rows = [row("a|one", { expires: "2020-01-01" })];
      const shared = { entries: rows, file: "f.json", now: NOW };

      expect(expiredRows({ ...shared, policy })).toMatchObject([
        { message: "Example row a|one expired 2020-01-01." },
      ]);
      expect(expiredRows({ ...shared, policy: shrinkOnly })).toEqual([]);
    });

    /** @scenario "An expired row is refused once, not twice" */
    it("leaves an expired row to the expiry check rather than calling it stale as well", () => {
      const rows = [row("a|one", { expires: "2020-01-01" })];

      expect(
        staleRows({
          entries: rows,
          found: new Set(),
          policy,
          file: "f.json",
          skipExpired: true,
          now: NOW,
        }),
      ).toEqual([]);
    });

    /** @scenario "An expired row stops exempting what it once allowed" */
    it("drops an expired row from the keys that still exempt something", () => {
      const rows = [
        row("a|one", { expires: "2020-01-01" }),
        row("b|two", { expires: "2099-01-01" }),
      ];

      expect([...liveKeys({ entries: rows, now: NOW })]).toEqual(["b|two"]);
    });
  });

  describe("when the file is compared with the merge base", () => {
    /** @scenario "A shrink check refuses a key the merge base did not carry" */
    it("refuses an added key, a raised count and a postponed date, and accepts every shrink", () => {
      const reference = [row("a|one", { expires: "2099-01-01", count: 10 })];
      const grown = [
        row("a|one", { expires: "2099-02-01", count: 11 }),
        row("b|two", { count: 1 }),
      ];

      expect(
        shrinkCheck({ current: grown, reference, policy, file: "f.json" }).map((v) => v.message),
      ).toEqual([
        "Example baseline cannot raise a|one.",
        "Example baseline cannot postpone a|one.",
        "Example baseline cannot add b|two.",
      ]);
      expect(
        shrinkCheck({
          current: [row("a|one", { expires: "2098-01-01", count: 9 })],
          reference,
          policy,
          file: "f.json",
        }),
      ).toEqual([]);
    });
  });

  describe("when a rule the merge base never carried is measured for the first time", () => {
    /** @scenario "A rule new to the tree seeds its rows rather than growing them" */
    it("accepts every row of the new rule and still refuses growth of a known one", () => {
      const seeding = {
        ...policy,
        growth: {
          ...policy.growth,
          seeds: (entry, reference) =>
            !reference.some((known) => known.key.split("|")[0] === entry.key.split("|")[0]),
        },
      } satisfies typeof policy;
      const reference = [row("a|one")];
      const current = [row("a|one"), row("a|two"), row("fresh|one"), row("fresh|two")];

      expect(
        shrinkCheck({ current, reference, policy: seeding, file: "f.json" }).map((v) => v.message),
      ).toEqual(["Example baseline cannot add a|two."]);
    });
  });

  describe("when a fresh measurement is written", () => {
    /** @scenario "A collected baseline keeps the date an existing row carries" */
    it("keeps the prior date, dates a new row today, and sorts by key", () => {
      const entries = collectBaseline({
        policy,
        found: ["b|two", "a|one"],
        previous: [row("b|two", { expires: "2099-01-01" })],
        now: NOW,
      });

      expect(entries).toEqual([
        { key: "a|one", measured: "2026-09-08" },
        { key: "b|two", measured: "2026-09-01", expires: "2099-01-01" },
      ]);
    });

    it("drops a date the policy would never read", () => {
      const entries = collectBaseline({
        policy: shrinkOnly,
        found: ["b|two"],
        previous: [row("b|two", { expires: "2099-01-01" })],
        now: NOW,
      });

      expect(entries).toEqual([{ key: "b|two", measured: "2026-09-01" }]);
    });

    /** @scenario "One writer, one stable output" */
    it("writes the version, the policy and the sorted rows, and reads back unchanged", () => {
      const entries = [row("a|one"), row("b|two", { count: 3 })];
      const text = formatBaseline({ policy, entries: [...entries].reverse() });
      const file = join(root, "written.json");

      expect(text).toBe(`${JSON.stringify(document(entries), null, 2)}\n`);

      writeFileSync(file, text);
      expect(readBaseline({ policy, file }).entries).toEqual(entries);
    });
  });
});
