import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lintStrictPortModules, type ClassifiedPackage } from "../src/index.ts";
import { snapshotOf } from "./workspace.ts";

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

function lint(): ReturnType<typeof lintStrictPortModules> {
  return lintStrictPortModules(snapshotOf({ root, packages: [packageForFixture()] }));
}

describe("strict feature ports", () => {
  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
    root = "";
  });

  /** @scenario "Strict services, ports, and contract builds remain mechanically bounded" */
  it("requires an exported abstract Port class while allowing supporting types", () => {
    root = mkdtempSync(join(tmpdir(), "strict-port-module-"));
    writePort(
      "export type ExampleId = string; export abstract class ExamplePort { abstract load(id: ExampleId): Promise<void>; }",
    );

    expect(lint()).toEqual([]);
  });

  /** @scenario "Strict services, ports, and contract builds remain mechanically bounded" */
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

  /** @scenario "A ratchet whose inventory reached zero becomes a plain refusal" */
  it("refuses a type-bag port with no inventory left to excuse it", () => {
    root = mkdtempSync(join(tmpdir(), "strict-port-module-"));
    const file = writePort("export type ExamplePort = { load(): Promise<void>; };");

    expect(lint()).toMatchObject([{ policy: "strict-port-module" }]);

    writeFileSync(file, "export abstract class ExamplePort { abstract load(): Promise<void>; }");
    expect(lint()).toEqual([]);
  });
});
