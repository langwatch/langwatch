import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareServiceCeilingsBaselines,
  lintServiceCeilingsFile,
  lintServiceCeilingsBaseline,
  readServiceCeilingsBaselineFile,
} from "../src";

const root = resolve(import.meta.dirname, "../../..");
const apiKeyService = "packages/features/api-key/server/src/services/api-key.service.ts";

describe("service ceilings baseline", () => {
  const ceiling = {
    file: "packages/features/project/server/src/services/project.service.ts",
    moduleLines: 600,
    methodLines: 90,
    statements: 30,
    complexity: 20,
    lineLength: 180,
  };

  /** @scenario "Strict services, ports, and contract builds remain mechanically bounded" */
  it("permits only a shrinking baseline", () => {
    expect(compareServiceCeilingsBaselines([ceiling], [], "baseline.json")).toEqual([]);
    expect(
      compareServiceCeilingsBaselines(
        [ceiling],
        [{ ...ceiling, moduleLines: 601 }],
        "baseline.json",
      ),
    ).toHaveLength(1);
    expect(
      compareServiceCeilingsBaselines(
        [ceiling],
        [
          {
            ...ceiling,
            file: "packages/features/user/server/src/services/user.service.ts",
          },
        ],
        "baseline.json",
      ),
    ).toHaveLength(1);
  });

  it("makes the reviewed first baseline an explicit one-time bootstrap", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "service-ceilings-bootstrap-"));
    const current = join(
      fixtureRoot,
      "packages/architecture-lint/src/service-ceilings-baseline.json",
    );
    mkdirSync(join(fixtureRoot, "packages/architecture-lint/src"), {
      recursive: true,
    });
    writeFileSync(current, JSON.stringify({ version: 0, services: [ceiling] }));

    expect(
      lintServiceCeilingsBaseline(fixtureRoot, join(fixtureRoot, "merge-base-baseline.json")),
    ).toEqual({ violations: [], bootstrapped: true });

    const missingBaselineRoot = mkdtempSync(join(tmpdir(), "missing-baseline-"));
    expect(
      lintServiceCeilingsBaseline(
        missingBaselineRoot,
        join(missingBaselineRoot, "merge-base-baseline.json"),
      ),
    ).toMatchObject({
      bootstrapped: false,
      violations: [{ policy: "service-ceilings-baseline" }],
    });
  });

  it("rejects malformed, duplicate, and unsorted baseline files", () => {
    const directory = mkdtempSync(join(tmpdir(), "service-ceilings-baseline-"));
    const file = join(directory, "baseline.json");
    for (const source of [
      "not json",
      JSON.stringify({ version: 0, services: [ceiling, ceiling] }),
      JSON.stringify({
        version: 0,
        services: [
          { ...ceiling, file: "z" },
          { ...ceiling, file: "a" },
        ],
      }),
      JSON.stringify({ version: 0, services: [{ file: ceiling.file }] }),
    ]) {
      writeFileSync(file, source);
      expect(readServiceCeilingsBaselineFile(file).violations).toHaveLength(1);
    }
  });

  /** @scenario "Strict services, ports, and contract builds remain mechanically bounded" */
  it("keeps the api-key service below the measured default ceiling", () => {
    expect(lintServiceCeilingsFile(root, apiKeyService)).toEqual([]);
  });

  it("keeps the api-key service free of discrete structural violations", () => {
    expect(() =>
      execFileSync(
        "pnpm",
        ["exec", "oxlint", "--config", ".oxlintrc.architecture.json", apiKeyService],
        { cwd: root, stdio: "pipe" },
      ),
    ).not.toThrow();
  });

  it("rejects a missing or stale ceiling without scanning the workspace", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "service-ceilings-file-"));
    const service = join(
      fixtureRoot,
      "packages/features/example/server/src/services/example.service.ts",
    );
    const baseline = join(
      fixtureRoot,
      "packages/architecture-lint/src/service-ceilings-baseline.json",
    );
    mkdirSync(join(fixtureRoot, "packages/architecture-lint/src"), { recursive: true });
    mkdirSync(join(fixtureRoot, "packages/features/example/server/src/services"), {
      recursive: true,
    });
    writeFileSync(service, `${"\n".repeat(500)}export class ExampleService {}\n`);

    expect(lintServiceCeilingsFile(fixtureRoot, service)).toMatchObject([
      { policy: "service-ceilings" },
    ]);

    writeFileSync(
      baseline,
      JSON.stringify({
        version: 0,
        services: [
          {
            ...ceiling,
            file: "packages/features/example/server/src/services/example.service.ts",
          },
        ],
      }),
    );
    writeFileSync(service, "export class ExampleService {}\n");

    expect(lintServiceCeilingsFile(fixtureRoot, service)).toMatchObject([
      { policy: "service-ceilings-baseline" },
    ]);
  });
});
