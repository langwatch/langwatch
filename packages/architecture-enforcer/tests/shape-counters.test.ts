import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  collectPortsAndAdaptersFoldersBaseline,
  collectPortsAndAdaptersFoldersFindings,
  formatBaseline,
  lintPortsAndAdaptersFolders,
  PORTS_AND_ADAPTERS_FOLDERS_BASELINE,
  type BaselinePolicy,
} from "../src/index.ts";
import { snapshotOf } from "./workspace.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "shape-counters-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

const PORTS_BASELINE =
  "packages/architecture-enforcer/src/ports-and-adapters-folders-baseline.json";

function baselineText(policy: BaselinePolicy, keys: readonly string[]): string {
  return formatBaseline({
    policy,
    entries: keys.map((key) => ({ key, measured: "2026-09-10" })),
  });
}

describe("ports and adapters folders", () => {
  describe("given a file under a module's ports or adapters folder", () => {
    /** @scenario A ports/adapters file is refused with the instruction to fold it into repositories or services */
    it("reports the file by its path", () => {
      write(
        "modules/widget/process/src/ports/widget-clock.port.ts",
        "export type WidgetClock = unknown;\n",
      );
      write(
        "enterprise/modules/billing/process/src/adapters/postgres.billing.adapter.ts",
        "export const adapter = 1;\n",
      );
      write("modules/widget/process/src/services/widget.service.ts", "export const service = 1;\n");

      const findings = collectPortsAndAdaptersFoldersFindings(root);

      expect(findings).toEqual([
        "enterprise/modules/billing/process/src/adapters/postgres.billing.adapter.ts",
        "modules/widget/process/src/ports/widget-clock.port.ts",
      ]);
    });
  });

  describe("given no module carries a ports or adapters folder", () => {
    it("reports nothing", () => {
      write("modules/widget/process/src/services/widget.service.ts", "export const service = 1;\n");
      write(
        "modules/widget/process/src/repositories/widget.repository.ts",
        "export const repo = 1;\n",
      );

      expect(collectPortsAndAdaptersFoldersFindings(root)).toEqual([]);
    });
  });

  describe("given a baseline", () => {
    it("silences a listed path and refuses a stale entry", () => {
      write(
        "modules/widget/process/src/ports/widget-clock.port.ts",
        "export type WidgetClock = unknown;\n",
      );
      write(
        PORTS_BASELINE,
        baselineText(PORTS_AND_ADAPTERS_FOLDERS_BASELINE, [
          "modules/widget/process/src/ports/widget-clock.port.ts",
          "modules/widget/process/src/ports/gone.port.ts",
        ]),
      );

      const violations = lintPortsAndAdaptersFolders(snapshotOf({ root }));

      expect(violations.map((violation) => violation.policy)).toEqual([
        "ports-and-adapters-folders-baseline",
      ]);
      expect(violations[0]!.message).toContain("gone.port.ts");
    });
  });

  it("collects the baseline sorted by path", () => {
    write("modules/widget/process/src/ports/b.port.ts", "export type B = unknown;\n");
    write("modules/widget/process/src/adapters/a.adapter.ts", "export const a = 1;\n");

    const entries = collectPortsAndAdaptersFoldersBaseline({ root });

    expect(entries.map((entry) => entry.key)).toEqual([
      "modules/widget/process/src/adapters/a.adapter.ts",
      "modules/widget/process/src/ports/b.port.ts",
    ]);
  });
});
