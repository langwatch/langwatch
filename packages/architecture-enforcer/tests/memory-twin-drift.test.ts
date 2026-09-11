import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectMemoryTwinDriftBaseline,
  collectMemoryTwinDriftFindings,
  formatBaseline,
  lintMemoryTwinDrift,
  MEMORY_TWIN_DRIFT_BASELINE,
} from "../src/index.ts";
import { snapshotOf } from "./workspace.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "memory-twin-drift-"));
  write("modules/widget/server/package.json", JSON.stringify({ name: "@langwatch/widget-server" }));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

const REPOSITORIES = "modules/widget/server/src/repositories";

const PACKAGE = "modules/widget/server";

const BASELINE = "packages/architecture-enforcer/src/memory-twin-drift-baseline.json";

function prisma(body: string, header = "export class PrismaWidgetRepository {"): void {
  write(`${REPOSITORIES}/prisma/prisma.widget.repository.ts`, `${header}\n${body}\n}\n`);
}

function memory(body: string, header = "export class MemoryWidgetRepository {"): void {
  write(`${REPOSITORIES}/memory/memory.widget.repository.ts`, `${header}\n${body}\n}\n`);
}

/** Rows keyed `<package directory>|<subject>|<side>|<method>`. */
function baselineText(keys: readonly string[]): string {
  return formatBaseline({
    policy: MEMORY_TWIN_DRIFT_BASELINE,
    entries: keys.map((key) => ({ key, measured: "2026-09-10" })),
  });
}

describe("memory twin drift", () => {
  describe("given a Prisma repository declaring a method its twin does not", () => {
    /** @scenario "A method the memory twin lacks is reported against the twin" */
    it("reports the twin, the repository and the method", () => {
      prisma("  findById(): void {}\n  findAll(): void {}");
      memory("  findById(): void {}");

      const found = collectMemoryTwinDriftFindings(root);

      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        packagePath: PACKAGE,
        subject: "WidgetRepository",
        side: "prisma",
        method: "findAll",
        path: `${REPOSITORIES}/memory/memory.widget.repository.ts`,
      });
      expect(found[0]!.message).toContain("the Prisma repository declares `findAll()`");
      expect(found[0]!.allowed).toContain("Implement `findAll()` on the memory twin");
    });

    it("pairs a twin that names the backend at the end of its class name", () => {
      write(
        `${REPOSITORIES}/prisma/prisma.widget-row.repository.ts`,
        "export class WidgetRowPrismaRepository {\n  findAll(): void {}\n}\n",
      );
      write(
        `${REPOSITORIES}/memory/memory.widget-row.repository.ts`,
        "export class WidgetRowMemoryRepository {}\n",
      );

      expect(collectMemoryTwinDriftFindings(root).map((one) => one.subject)).toEqual([
        "WidgetRowRepository",
      ]);
    });

    it("pairs on the interface a class says it implements", () => {
      prisma("  findAll(): void {}", "export class PrismaThing implements WidgetRepository {");
      memory("", "export class MemoryThing implements WidgetRepository {");

      expect(collectMemoryTwinDriftFindings(root).map((one) => one.method)).toEqual(["findAll"]);
    });
  });

  describe("given a memory twin declaring a method the Prisma repository does not", () => {
    /** @scenario "A method only the memory twin declares is reported against the Prisma repository" */
    it("reports the Prisma repository as the side that is short", () => {
      prisma("  findById(): void {}");
      memory("  findById(): void {}\n  seed(): void {}");

      const found = collectMemoryTwinDriftFindings(root);

      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        side: "memory",
        method: "seed",
        path: `${REPOSITORIES}/prisma/prisma.widget.repository.ts`,
      });
      expect(found[0]!.allowed).toContain("missing in production");
    });
  });

  describe("given twins that carry the same methods", () => {
    /** @scenario "Twins that carry the same methods report nothing" */
    it("reports nothing, and counts neither a private nor a static member", () => {
      prisma(
        "  static create(): void {}\n  findById(): void {}\n  private map(): void {}\n  #cache(): void {}",
      );
      memory("  static create(): void {}\n  findById(): void {}\n  private index(): void {}");

      expect(collectMemoryTwinDriftFindings(root)).toEqual([]);
    });

    it("reports nothing when a package has no memory folder at all", () => {
      prisma("  findAll(): void {}");

      expect(collectMemoryTwinDriftFindings(root)).toEqual([]);
    });
  });

  describe("given a baseline", () => {
    /** @scenario "A baselined drift is silent and a stale baseline entry is reported" */
    it("silences listed findings and refuses an entry that no longer holds", () => {
      prisma("  findAll(): void {}");
      memory("");
      write(
        BASELINE,
        baselineText([
          `${PACKAGE}|WidgetRepository|prisma|findAll`,
          `${PACKAGE}|WidgetRepository|prisma|findGone`,
        ]),
      );

      const violations = lintMemoryTwinDrift(snapshotOf({ root }));

      expect(violations.map((violation) => violation.policy)).toEqual([
        "memory-twin-drift-baseline",
      ]);
      expect(violations[0]!.message).toContain(
        `${PACKAGE} WidgetRepository prisma findGone no longer matches anything`,
      );
    });

    it("reports an unlisted finding under the policy name", () => {
      prisma("  findAll(): void {}");
      memory("");
      write(BASELINE, baselineText([`${PACKAGE}|WidgetRepository|prisma|findGone`]));

      const policies = lintMemoryTwinDrift(snapshotOf({ root })).map(
        (violation) => violation.policy,
      );

      expect(policies).toContain("memory-twin-drift");
      expect(policies).toContain("memory-twin-drift-baseline");
    });

    it("collects the baseline as rows sorted by key, keeping the date a row carries", () => {
      prisma("  findAll(): void {}\n  findById(): void {}");
      memory("");

      const entries = collectMemoryTwinDriftBaseline({
        root,
        previous: [{ key: `${PACKAGE}|WidgetRepository|prisma|findAll`, measured: "2020-01-01" }],
      });

      expect(entries).toEqual([
        { key: `${PACKAGE}|WidgetRepository|prisma|findAll`, measured: "2020-01-01" },
        { key: `${PACKAGE}|WidgetRepository|prisma|findById`, measured: expect.any(String) },
      ]);
    });
  });
});
