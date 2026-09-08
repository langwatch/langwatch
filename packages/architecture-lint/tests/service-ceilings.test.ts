import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { lintServiceCeilingsFile } from "../src/index.ts";

const root = resolve(import.meta.dirname, "../../..");
const apiKeyService = "packages/features/api-key/server/src/services/api-key.service.ts";

describe("service ceilings", () => {
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

  /** @scenario "A ratchet whose inventory reached zero becomes a plain refusal" */
  it("refuses an over-ceiling service with no per-file inventory left to raise it", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "service-ceilings-file-"));
    const service = join(
      fixtureRoot,
      "packages/features/example/server/src/services/example.service.ts",
    );
    mkdirSync(join(fixtureRoot, "packages/features/example/server/src/services"), {
      recursive: true,
    });
    writeFileSync(service, `${"\n".repeat(500)}export class ExampleService {}\n`);

    expect(lintServiceCeilingsFile(fixtureRoot, service)).toMatchObject([
      { policy: "service-ceilings" },
    ]);

    writeFileSync(service, "export class ExampleService {}\n");

    expect(lintServiceCeilingsFile(fixtureRoot, service)).toEqual([]);
  });
});
