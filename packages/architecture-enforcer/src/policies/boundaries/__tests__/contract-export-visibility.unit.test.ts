/**
 * Spec: specs/contract-export-visibility.feature.
 * Record: dev/docs/plans/platform-architecture-blocks.md rules 12b and 12c.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ClassifiedPackage } from "../../../types.ts";
import { forgetFileListings } from "../../../workspace/layout.ts";
import { buildWorkspaceSnapshot, type WorkspaceSnapshot } from "../../../workspace/snapshot.ts";
import { collectTuningImports, lintContractTuningConstants } from "../contract-tuning-constant.ts";
import { collectOwnerOnlyImports, lintOwnerOnlyConstants } from "../owner-only-constant.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-contract-export-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  forgetFileListings();
});

function write({ path, content }: { path: string; content: string }): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function contract(module: string): ClassifiedPackage {
  const packageRoot = join(root, "modules", module, "contract");

  return {
    name: `@langwatch/${module}-contract`,
    root: packageRoot,
    manifestPath: join(packageRoot, "package.json"),
    manifest: {},
    kind: "contract",
    feature: module,
    enterprise: false,
  };
}

function snapshot(): WorkspaceSnapshot {
  const read = buildWorkspaceSnapshot({ root, changedFiles: [] });

  return { ...read, packages: [contract("a"), contract("b")] };
}

function ownerOnly(): string[] {
  return collectOwnerOnlyImports(snapshot())
    .map((use) => `${use.file}:${use.line}|${use.export.name}`)
    .toSorted();
}

function tuning(): string[] {
  return collectTuningImports(snapshot())
    .map((use) => `${use.file}:${use.line}|${use.export.name}`)
    .toSorted();
}

describe("owner-only-constant", () => {
  describe("given module a's contract tags PARAM as @ownerOnly", () => {
    function declare(): void {
      write({
        path: "modules/a/contract/src/link.ts",
        content:
          '/** @ownerOnly The address is a\'s own. */\nexport const A_PARAM = "a";\nexport const A_OTHER = "other";\n',
      });
    }

    describe("when module b imports it and an app re-exports it", () => {
      /** @scenario "A peer module importing an @ownerOnly export is reported" */
      it("reports both uses", () => {
        declare();
        write({
          path: "modules/b/browser/src/use.ts",
          content: 'import { A_PARAM } from "@langwatch/a-contract";\nexport const x = A_PARAM;\n',
        });
        write({
          path: "apps/ui/src/re.ts",
          content: 'export { A_PARAM } from "@langwatch/a-contract";\n',
        });

        expect(ownerOnly()).toEqual([
          "apps/ui/src/re.ts:1|A_PARAM",
          "modules/b/browser/src/use.ts:1|A_PARAM",
        ]);
      });
    });

    describe("when module b reads it off a namespace import", () => {
      /** @scenario "A peer module reading an @ownerOnly export off a namespace import is reported" */
      it("reports the tagged read only", () => {
        declare();
        write({
          path: "modules/b/browser/src/use.ts",
          content:
            'import * as a from "@langwatch/a-contract";\nexport const x = a.A_OTHER;\nexport const y = a.A_PARAM;\n',
        });

        expect(ownerOnly()).toEqual(["modules/b/browser/src/use.ts:3|A_PARAM"]);
      });
    });

    describe("when only the owner's packages and untagged exports are imported", () => {
      /** @scenario "The owner's own packages and untagged exports are not reported" */
      it("reports nothing", () => {
        declare();
        write({
          path: "modules/a/process/src/use.ts",
          content: 'import { A_PARAM } from "@langwatch/a-contract";\nexport const x = A_PARAM;\n',
        });
        write({
          path: "modules/a/browser/src/use.ts",
          content: 'import { A_PARAM } from "@langwatch/a-contract";\nexport const x = A_PARAM;\n',
        });
        write({
          path: "modules/b/browser/src/use.ts",
          content: 'import { A_OTHER } from "@langwatch/a-contract";\nexport const x = A_OTHER;\n',
        });

        expect(ownerOnly()).toEqual([]);
      });
    });

    describe("when the finding is reported", () => {
      /** @scenario "An owner-only finding says what to do instead" */
      it("names the constant and asks for an action or a link builder", () => {
        declare();
        write({
          path: "modules/b/browser/src/use.ts",
          content: 'import { A_PARAM } from "@langwatch/a-contract";\nexport const x = A_PARAM;\n',
        });

        const [violation] = lintOwnerOnlyConstants(snapshot());

        expect(violation?.message).toContain("A_PARAM");
        expect(violation?.message).toContain("modules/a");
        expect(violation?.message).toContain("modules/b");
        expect(violation?.allowed).toContain("action or a link builder");
      });
    });
  });
});

describe("contract-tuning-constant", () => {
  describe("given module a's contract exports tuning numbers", () => {
    function declare(): void {
      write({
        path: "modules/a/contract/src/limits.ts",
        content: [
          "export const CALL_TIMEOUT_MS = 1000;",
          "export const KEY_TTL_SECONDS = 60;",
          "export const MAX_RETRIES = 3;",
          "export const MAX_ATTEMPTS = 5;",
          "export const POLL_INTERVAL = 10;",
          "export const DAYS_BEFORE_OFF = 7;",
          'export const RESERVED_KEY_MS = "langwatch.reserved.key_ms";',
          "export const WINDOW_MS = { day: 1 } as const;",
          "",
        ].join("\n"),
      });
    }

    describe("when module b imports each number", () => {
      /** @scenario "A peer module importing a tuning number is reported" */
      it("reports each import", () => {
        declare();
        write({
          path: "modules/b/process/src/use.ts",
          content:
            'import {\n  CALL_TIMEOUT_MS,\n  KEY_TTL_SECONDS,\n  MAX_RETRIES,\n  MAX_ATTEMPTS,\n  POLL_INTERVAL,\n  DAYS_BEFORE_OFF,\n} from "@langwatch/a-contract";\nexport const x = [CALL_TIMEOUT_MS, KEY_TTL_SECONDS, MAX_RETRIES, MAX_ATTEMPTS, POLL_INTERVAL, DAYS_BEFORE_OFF];\n',
        });

        expect(tuning().map((item) => item.split("|")[1] ?? "")).toEqual([
          "CALL_TIMEOUT_MS",
          "KEY_TTL_SECONDS",
          "MAX_RETRIES",
          "MAX_ATTEMPTS",
          "POLL_INTERVAL",
          "DAYS_BEFORE_OFF",
        ]);
      });
    });

    describe("when module b reads minutes, hours, a TTL and a delay off a namespace", () => {
      /** @scenario "Minutes, hours, TTLs, delays and namespace reads are tuning numbers too" */
      it("reports each read", () => {
        write({
          path: "modules/a/contract/src/windows.ts",
          content: [
            "export const GRACE_MINUTES = 5;",
            "export const RETENTION_HOURS = 24;",
            "export const CACHE_TTL = 30;",
            "export const RETRY_DELAY = 100;",
            "",
          ].join("\n"),
        });
        write({
          path: "modules/b/process/src/use.ts",
          content:
            'import * as a from "@langwatch/a-contract";\nexport const x = [a.GRACE_MINUTES, a.RETENTION_HOURS, a.CACHE_TTL, a.RETRY_DELAY];\n',
        });

        expect(
          tuning()
            .map((item) => item.split("|")[1] ?? "")
            .toSorted((left, right) => left.localeCompare(right)),
        ).toEqual(["CACHE_TTL", "GRACE_MINUTES", "RETENTION_HOURS", "RETRY_DELAY"]);
      });
    });

    describe("when only the owner, a string, a map or a type is involved", () => {
      /** @scenario "The owner's own packages, strings, maps and type imports are not reported" */
      it("reports nothing", () => {
        declare();
        write({
          path: "modules/a/process/src/use.ts",
          content:
            'import { CALL_TIMEOUT_MS } from "@langwatch/a-contract";\nexport const x = CALL_TIMEOUT_MS;\n',
        });
        write({
          path: "modules/b/process/src/use.ts",
          content:
            'import { RESERVED_KEY_MS, WINDOW_MS, type CALL_TIMEOUT_MS } from "@langwatch/a-contract";\nimport type { MAX_RETRIES } from "@langwatch/a-contract";\nexport const x = [RESERVED_KEY_MS, WINDOW_MS];\n',
        });

        expect(tuning()).toEqual([]);
      });
    });

    describe("when the finding is reported", () => {
      /** @scenario "A tuning number finding says what to do instead" */
      it("names the constant and asks for the owner's Api", () => {
        declare();
        write({
          path: "modules/b/process/src/use.ts",
          content:
            'import { CALL_TIMEOUT_MS } from "@langwatch/a-contract";\nexport const x = CALL_TIMEOUT_MS;\n',
        });

        const [violation] = lintContractTuningConstants(snapshot());

        expect(violation?.message).toContain("CALL_TIMEOUT_MS");
        expect(violation?.message).toContain("modules/b");
        expect(violation?.allowed).toContain("through its Api");
      });
    });
  });
});
