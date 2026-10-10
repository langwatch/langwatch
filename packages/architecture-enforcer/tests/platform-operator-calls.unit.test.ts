/** Spec: specs/tooling/lint-platform-operator-calls.feature. Record: ARCHITECTURE.md §7. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lintPlatformOperatorCalls } from "../src/policies/boundaries/platform-operator-calls.ts";
import type { FeatureCatalogueEntry } from "../src/types.ts";
import { snapshotOf } from "./workspace.ts";

const CATALOGUE: FeatureCatalogueEntry[] = ["billing", "ops", "identity", "authz"].map((id) => ({
  id,
  root: `modules/${id}`,
  classification: "core",
  subjects: [id],
}));

const IMPORT = 'import type { AuthzApi } from "@langwatch/authz-contract";\n';
let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "platform-operator-calls-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function run() {
  return lintPlatformOperatorCalls(snapshotOf({ root, catalogue: CATALOGUE }));
}

describe("platform-operator-calls", () => {
  /** @scenario "A module other than ops or identity calls an operation" */
  it("reports a billing file that calls grantPlatformOperator", () => {
    write(
      "modules/billing/process/src/services/x.ts",
      `${IMPORT}export const x = (api: AuthzApi) => api.grantPlatformOperator({});\n`,
    );

    const violations = run();

    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toContain("modules/billing/process/src/services/x.ts");
    expect(violations[0]?.line).toBe(2);
    expect(violations[0]?.message).toContain("grantPlatformOperator");
  });

  /** @scenario "The ops module calls an operation" */
  it("allows ops", () => {
    write(
      "modules/ops/process/src/x.ts",
      `${IMPORT}export const x = (api: AuthzApi) => api.grantPlatformOperator({});\n`,
    );

    expect(run()).toEqual([]);
  });

  /** @scenario "Another module lists the platform operators" */
  it("allows any module to list", () => {
    write(
      "modules/billing/process/src/services/z.ts",
      `${IMPORT}export const z = (api: AuthzApi) => api.listPlatformOperators();\n`,
    );

    expect(run()).toEqual([]);
  });

  /** @scenario "The identity module calls an operation" */
  it("allows identity", () => {
    write(
      "modules/identity/process/src/x.ts",
      `${IMPORT}export const x = (api: AuthzApi) => api.revokePlatformOperator({});\n`,
    );

    expect(run()).toEqual([]);
  });

  /** @scenario "The authz module declares and serves the operations" */
  it("allows authz", () => {
    write(
      "modules/authz/process/src/x.ts",
      "export const x = (app: { grantPlatformOperator: () => void }) => app.grantPlatformOperator();\n",
    );

    expect(run()).toEqual([]);
  });

  /** @scenario "A file outside any module calls an operation" */
  it("reports an application file", () => {
    write(
      "apps/api/src/x.ts",
      `${IMPORT}export const x = (api: AuthzApi) => api.revokePlatformOperator({});\n`,
    );

    const violations = run();

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("outside a module");
  });

  /** @scenario "A same-named method on something that is not AuthzApi is not a call" */
  it("ignores a file that never imports the authz contract", () => {
    write(
      "modules/billing/process/src/y.ts",
      "export const y = (other: { grantPlatformOperator: () => void }) => other.grantPlatformOperator();\n",
    );

    expect(run()).toEqual([]);
  });
});
