/**
 * @vitest-environment node
 * @see specs/tooling/lint-composed-exports.feature
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lintComposedExports, lintPolicies, POLICIES } from "../src/index.ts";
import { snapshotOf, writePolicyAnchors } from "./workspace.ts";

let root = "";

function write(path: string, contents: string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function manifest(path: string, name: string): void {
  write(`${path}/package.json`, JSON.stringify({ name, main: "./src/index.ts" }));
}

function reported(): string[] {
  return lintComposedExports(snapshotOf({ root })).map((violation) => violation.message);
}

/** One application reaching one composition, and one feature server package
 * publishing a composed service beside an uncomposed one. */
function writeWorkspace(): void {
  manifest("apps/api", "@fixture/api");
  write(
    "apps/api/src/main.ts",
    `import { composeApi } from "./app/api.composition.ts";\ncomposeApi();\n`,
  );
  write(
    "apps/api/src/app/api.composition.ts",
    `import { ComposedService } from "@fixture/thing-server";\n` +
      `export function composeApi() {\n  return ComposedService.create({});\n}\n`,
  );
  manifest("modules/thing/process", "@fixture/thing-server");
  write(
    "modules/thing/process/src/services/composed.service.ts",
    `export class ComposedService {\n  static create(options: object) {\n    return new ComposedService();\n  }\n}\n`,
  );
  write(
    "modules/thing/process/src/services/uncomposed.service.ts",
    `export class UncomposedService {\n  static create() {\n    return new UncomposedService();\n  }\n}\n`,
  );
  write(
    "modules/thing/process/src/index.ts",
    `export { ComposedService } from "./services/composed.service.ts";\n` +
      `export { UncomposedService } from "./services/uncomposed.service.ts";\n`,
  );
}

describe("composed exports", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "composed-exports-"));
    writeWorkspace();
    writePolicyAnchors(root);
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });

    root = "";
  });

  describe("when a server package publishes a service no application builds", () => {
    /** @scenario "An export no application constructs is reported" */
    it("reports the service by name and by owning package", () => {
      const messages = reported();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("`UncomposedService` is exported from");
      expect(messages[0]).toContain("`modules/thing/process`");
      expect(messages[0]).toContain("composed by no application");
      expect(messages[0]).toContain("Compose it in the owning `*.composition.ts`, or delete it");
    });

    /** @scenario "An export the composition constructs is accepted" */
    it("accepts the service the composition constructs", () => {
      expect(reported().join("\n")).not.toContain("ComposedService");
    });
  });

  describe("when a transport factory is mounted by nothing", () => {
    /** @scenario "A transport factory nothing mounts is reported" */
    it("reports the factory by name", () => {
      write(
        "modules/thing/process/src/transport/thing-webhook.api.ts",
        `export function createThingWebhookRestApp() {\n  return {};\n}\n`,
      );
      write(
        "modules/thing/process/src/index.ts",
        `export { ComposedService } from "./services/composed.service.ts";\n` +
          `export { createThingWebhookRestApp } from "./transport/thing-webhook.api.ts";\n`,
      );

      expect(reported().join("\n")).toContain("`createThingWebhookRestApp` is exported from");
    });
  });

  describe("when the only reachable mention is not a construction", () => {
    /** @scenario "Re-exporting a class is not composing it" */
    it("does not accept a re-export as evidence", () => {
      write(
        "apps/api/src/app/barrel.ts",
        `export { UncomposedService } from "@fixture/thing-server";\n`,
      );
      write(
        "apps/api/src/main.ts",
        `import { composeApi } from "./app/api.composition.ts";\n` +
          `import "./app/barrel.ts";\ncomposeApi();\n`,
      );

      expect(reported().join("\n")).toContain("`UncomposedService` is exported from");
    });

    /** @scenario "Naming a class in a comment is not composing it" */
    it("does not accept a comment as evidence", () => {
      write(
        "apps/api/src/app/api.composition.ts",
        `import { ComposedService } from "@fixture/thing-server";\n` +
          `// TODO: compose UncomposedService here as well.\n` +
          `export function composeApi() {\n  return ComposedService.create({});\n}\n`,
      );

      expect(reported().join("\n")).toContain("`UncomposedService` is exported from");
    });

    /** @scenario "Naming a class only as a type is not composing it" */
    it("does not accept a type annotation as evidence", () => {
      write(
        "apps/api/src/app/api.composition.ts",
        `import { ComposedService } from "@fixture/thing-server";\n` +
          `import type { UncomposedService } from "@fixture/thing-server";\n` +
          `export function composeApi(): UncomposedService | undefined {\n` +
          `  ComposedService.create({});\n  return undefined;\n}\n`,
      );

      expect(reported().join("\n")).toContain("`UncomposedService` is exported from");
    });
  });

  describe("when the export is a shape no process composes", () => {
    /** @scenario "A testing export is not required to be composed" */
    it("skips a service published from a testing module", () => {
      write(
        "modules/thing/process/src/testing/fake.service.ts",
        `export class FakeThingService {}\n`,
      );
      write(
        "modules/thing/process/src/index.ts",
        `export { ComposedService } from "./services/composed.service.ts";\n` +
          `export { FakeThingService } from "./testing/fake.service.ts";\n`,
      );

      expect(reported()).toEqual([]);
    });

    /** @scenario "An abstract port is not required to be composed" */
    it("skips an abstract port class", () => {
      write(
        "modules/thing/process/src/ports/thing.port.ts",
        `export abstract class ThingLookupService {\n  abstract find(): void;\n}\n`,
      );
      write(
        "modules/thing/process/src/index.ts",
        `export { ComposedService } from "./services/composed.service.ts";\n` +
          `export { ThingLookupService } from "./ports/thing.port.ts";\n`,
      );

      expect(reported()).toEqual([]);
    });

    /** @scenario "An error class is not required to be composed" */
    it("skips a class that extends an error", () => {
      write(
        "modules/thing/process/src/rules/thing.errors.ts",
        `export class ThingRefusedService extends HandledError {}\n`,
      );
      write(
        "modules/thing/process/src/index.ts",
        `export { ComposedService } from "./services/composed.service.ts";\n` +
          `export { ThingRefusedService } from "./rules/thing.errors.ts";\n`,
      );

      expect(reported()).toEqual([]);
    });

    /** @scenario "A schema export is not required to be composed" */
    it("skips a zod schema and its inferred type", () => {
      write(
        "modules/thing/process/src/rules/thing.schema.ts",
        `import { z } from "zod";\n` +
          `export const thingServiceSchema = z.object({});\n` +
          `export type ThingService = z.infer<typeof thingServiceSchema>;\n`,
      );
      write(
        "modules/thing/process/src/index.ts",
        `export { ComposedService } from "./services/composed.service.ts";\n` +
          `export { thingServiceSchema } from "./rules/thing.schema.ts";\n` +
          `export type { ThingService } from "./rules/thing.schema.ts";\n`,
      );

      expect(reported()).toEqual([]);
    });
  });

  describe("when the package is not server code", () => {
    /** @scenario "A web package is not read at all" */
    it("skips a web package", () => {
      manifest("modules/thing/browser", "@fixture/thing-web");
      write("modules/thing/browser/src/index.ts", `export class BrowserThingService {}\n`);
      write("modules/thing/process/src/index.ts", "export {};\n");

      expect(reported()).toEqual([]);
    });

    /** @scenario "A contract package is not read at all" */
    it("skips a contract package", () => {
      manifest("modules/thing/contract", "@fixture/thing-contract");
      write("modules/thing/contract/src/index.ts", `export class WireThingService {}\n`);
      write("modules/thing/process/src/index.ts", "export {};\n");

      expect(reported()).toEqual([]);
    });
  });

  describe("when the finding is reported through the registry (cwd differs from the workspace root)", () => {
    /** @scenario "A composed-exports finding names a file that exists on disk" */
    it("reports a path that resolves against the workspace root, not the enforcer's own package root", () => {
      const composedExportsPolicy = POLICIES.find((policy) => policy.id === "composed-exports");
      if (!composedExportsPolicy) throw new Error("composed-exports policy is not registered");

      const findings = lintPolicies(snapshotOf({ root }), [composedExportsPolicy]).filter(
        (violation) => violation.policy === "composed-exports",
      );

      expect(findings.length).toBeGreaterThan(0);

      for (const finding of findings) {
        expect(existsSync(join(root, finding.file))).toBe(true);
      }
    });
  });

  describe("when a process entrypoint the walk starts from is missing", () => {
    /** @scenario "A policy whose anchor file is gone refuses the run by name" */
    it("throws naming the policy and the entrypoint instead of reporting every export", () => {
      rmSync(join(root, "apps/tasks/src/main.ts"));

      expect(() => reported()).toThrow(
        "composed-exports: its anchor apps/tasks/src/main.ts does not exist",
      );
    });
  });
});
