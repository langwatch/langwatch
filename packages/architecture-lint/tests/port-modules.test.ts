import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectStrictPortBaseline,
  formatStrictPortBaseline,
  lintStrictPortBaseline,
  lintStrictPortModules,
  type ClassifiedPackage,
} from "../src";

let root = "";

function packageForFixture(): ClassifiedPackage {
  const featureRoot = join(root, "packages/features/example");
  const serverRoot = join(featureRoot, "server");
  return {
    name: "@langwatch/example-server",
    root: serverRoot,
    manifestPath: join(serverRoot, "package.json"),
    manifest: {},
    kind: "server",
    feature: "example",
    featureRoot,
    layoutVersion: 0,
    subjects: [],
    enterprise: false,
  };
}

function writePort(source: string): string {
  const file = join(root, "packages/features/example/server/src/ports/example.port.ts");
  mkdirSync(join(root, "packages/features/example/server/src/ports"), {
    recursive: true,
  });
  writeFileSync(file, source);
  return file;
}

function writeBaseline(ports: string[]): void {
  const directory = join(root, "packages/architecture-lint/src");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "port-module-baseline.json"),
    JSON.stringify({ version: 0, ports }),
  );
}

function lint(): ReturnType<typeof lintStrictPortModules> {
  return lintStrictPortModules(root, [packageForFixture()]);
}

describe("strict feature ports", () => {
  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
    root = "";
  });

  it("requires an exported abstract Port class while allowing supporting types", () => {
    root = mkdtempSync(join(tmpdir(), "strict-port-module-"));
    writePort(
      "export type ExampleId = string; export abstract class ExamplePort { abstract load(id: ExampleId): Promise<void>; }",
    );

    expect(lint()).toEqual([]);
  });

  it("rejects a new callback or object type bag masquerading as a port", () => {
    root = mkdtempSync(join(tmpdir(), "strict-port-module-"));
    writePort("export type ExamplePort = { load(id: string): Promise<void>; };");

    expect(lint()).toMatchObject([{ policy: "strict-port-module" }]);
  });

  it("rejects a callback type bag even beside a valid abstract port class", () => {
    root = mkdtempSync(join(tmpdir(), "strict-port-module-"));
    writePort(
      "export abstract class ExamplePort { abstract load(): Promise<void>; } export type LegacyExamplePort = { load(): Promise<void>; };",
    );

    expect(lint()).toMatchObject([{ policy: "strict-port-module" }]);
  });

  it("collects and formats the exact legacy inventory reproducibly", () => {
    root = mkdtempSync(join(tmpdir(), "strict-port-module-"));
    writePort("export type ExamplePort = { load(): Promise<void>; };");
    const ports = collectStrictPortBaseline(root, [packageForFixture()]);

    expect(ports).toEqual(["packages/features/example/server/src/ports/example.port.ts"]);
    expect(formatStrictPortBaseline(ports)).toBe(
      `${JSON.stringify({ version: 0, ports }, null, 2)}\n`,
    );
  });

  it("only permits listed legacy ports and makes the entry stale after conversion", () => {
    root = mkdtempSync(join(tmpdir(), "strict-port-module-"));
    const file = writePort("export type ExamplePort = { load(): Promise<void>; };");
    const relativeFile = "packages/features/example/server/src/ports/example.port.ts";
    writeBaseline([relativeFile]);

    expect(lint()).toEqual([]);

    writeFileSync(file, "export abstract class ExamplePort { abstract load(): Promise<void>; }");
    expect(lint()).toMatchObject([{ policy: "strict-port-baseline" }]);
  });

  it("bootstraps once and then rejects a larger strict-port inventory", () => {
    root = mkdtempSync(join(tmpdir(), "strict-port-module-"));
    const legacyPort = "packages/features/example/server/src/ports/legacy.port.ts";
    writeBaseline([legacyPort]);
    const reference = join(root, "merge-base-port-module-baseline.json");

    expect(lintStrictPortBaseline(root, reference)).toEqual({
      violations: [],
      bootstrapped: true,
    });

    writeFileSync(reference, JSON.stringify({ version: 0, ports: [legacyPort] }));
    writeBaseline([legacyPort, "packages/features/example/server/src/ports/new.port.ts"]);

    expect(lintStrictPortBaseline(root, reference)).toMatchObject({
      bootstrapped: false,
      violations: [{ policy: "strict-port-baseline-growth" }],
    });
  });
});
