import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceModuleResolver } from "../src/workspace/module-graph.ts";
import { lintFeatureSetupInfrastructure } from "../src/policies/feature-app.ts";
import type { ClassifiedPackage, FeatureCatalogueEntry } from "../src/types.ts";
import { snapshotOf } from "./workspace.ts";

let root: string;
let packages: ClassifiedPackage[];
let catalogue: FeatureCatalogueEntry[];

function write(file: string, text: string): void {
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

function server(feature: string, kind: "server" | "contract"): ClassifiedPackage {
  const directory = `packages/features/${feature}/${kind}`;
  const manifest = { name: `@langwatch/${feature}-${kind}` };
  write(`${directory}/package.json`, JSON.stringify(manifest));
  return {
    name: manifest.name,
    root: join(root, directory),
    manifestPath: join(root, directory, "package.json"),
    manifest,
    kind,
    feature,
    layoutVersion: 0,
    enterprise: false,
  };
}

function findings(body: string, extras = ""): ReturnType<typeof lintFeatureSetupInfrastructure> {
  write(
    "packages/features/widget/server/src/app/widget.app.ts",
    `import type { FeatureSetup } from "@langwatch/runtime-composition";
${extras}
${body}`,
  );
  return lintFeatureSetupInfrastructure(snapshotOf({ root, catalogue, packages }));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "feature-setup-infrastructure-"));
  packages = [server("widget", "server"), server("foreign", "contract")];
  write(
    "packages/features/foreign/contract/src/foreign.api.ts",
    "export interface ForeignApi { read(): void }",
  );
  write(
    "packages/features/foreign/contract/src/index.ts",
    'export type { ForeignApi } from "./foreign.api";',
  );
  catalogue = [
    {
      id: "widget",
      root: "packages/features/widget",
      classification: "core",
      subjects: ["widget"],
    },
    {
      id: "foreign",
      root: "packages/features/foreign",
      classification: "core",
      subjects: ["foreign"],
    },
  ];
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("FeatureSetup infrastructure capability guard", () => {
  it("reports owned and foreign feature capabilities", () => {
    const result = findings(
      `
      interface WidgetService { run(): void }
      interface Infra { own: WidgetService; peer: ForeignApi }
      class WidgetApp { static create(setup: FeatureSetup<{}, Infra, undefined>) { return setup } }
    `,
      `import type { ForeignApi } from "../../../../foreign/contract/src/index";`,
    );
    expect(result).toHaveLength(2);
    expect(result.map((item) => item.message).join(" ")).toContain("capability");
  });

  it("follows aliases, generic substitution, nested records, and retained Pick fields", () => {
    const result = findings(`
      interface WidgetService { run(): void }
      interface Infra { service: WidgetService; technical: { port: { send(): void } } }
      type Alias<T> = FeatureSetup<{}, T, undefined>
      class WidgetApp { static create(setup: Alias<Pick<Infra, "service">>) { return setup } }
    `);
    expect(result).toHaveLength(1);
  });

  it("does not report omitted services or technical ports and DTOs", () => {
    const result = findings(`
      interface WidgetService { run(input: { value: string }): void }
      interface Infra { service: WidgetService; technical: { port: { send(input: { value: string }): void } } }
      class WidgetApp { static create(setup: FeatureSetup<{}, Omit<Infra, "service">, undefined>) { return setup } }
    `);
    expect(result).toEqual([]);
  });

  it("reports callback locators and ignores unrelated service names", () => {
    const result = findings(`
      interface WidgetService { run(): void }
      interface SomethingService { run(): void }
      interface Infra { callback: () => WidgetService; unrelated: SomethingService }
      class WidgetApp { static create(setup: FeatureSetup<{}, Infra, undefined>) { return setup } }
    `);
    expect(result).toHaveLength(1);
  });

  it("terminates recursive aliases", () => {
    const result = findings(`
      interface WidgetService { run(): void }
      type Loop = { next: Loop; service: WidgetService }
      class WidgetApp { static create(setup: FeatureSetup<{}, Loop, undefined>) { return setup } }
    `);
    expect(result).toHaveLength(1);
  });

  it("resolves renamed setup imports and ignores unused generic arguments", () => {
    const result = findings(
      `
      interface WidgetService { run(): void }
      interface Infra { service: WidgetService }
      class WidgetApp { static create(setup: Setup<{}, Infra, Unused>) { return setup } }
    `,
      `import type { FeatureSetup as Setup } from "@langwatch/runtime-composition";
type Unused = string;`,
    );
    expect(result).toHaveLength(1);
  });

  it("resolves namespace setup imports", () => {
    const result = findings(
      `
      interface WidgetService { run(): void }
      interface Infra { service: WidgetService }
      class WidgetApp { static create(setup: Runtime.FeatureSetup<{}, Infra, undefined>) { return setup } }
    `,
      `import * as Runtime from "@langwatch/runtime-composition";`,
    );
    expect(result).toHaveLength(1);
  });

  it("reports capabilities from enterprise feature packages", () => {
    const foreign = packages[1];
    if (!foreign) throw new Error("foreign package fixture missing");

    packages[1] = { ...foreign, enterprise: true };
    const result = findings(
      `
      interface WidgetService { run(): void }
      interface Infra { service: WidgetService; peer: ForeignApi }
      class WidgetApp { static create(setup: FeatureSetup<{}, Infra, undefined>) { return setup } }
    `,
      `import type { ForeignApi } from "../../../../foreign/contract/src/index";`,
    );
    expect(result).toHaveLength(2);
  });

  it("reports an actionable diagnostic for computed infrastructure", () => {
    const result = findings(`
      type Infra = { service: WidgetService } extends infer T ? T : never
      interface WidgetService { run(): void }
      class WidgetApp { static create(setup: FeatureSetup<{}, Infra, undefined>) { return setup } }
    `);
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toContain("Cannot verify computed");
  });

  it("unwraps readonly infrastructure and detects arbitrary owned service classes", () => {
    write(
      "packages/features/widget/server/src/service/custom.service.ts",
      "export class AuxiliaryService { run(): void {} }",
    );
    const result = findings(
      `
      import type { AuxiliaryService } from "../service/custom.service";
      interface Infra { service: AuxiliaryService }
      class WidgetApp { static create(setup: FeatureSetup<{}, Readonly<Infra>, undefined>) { return setup } }
    `,
    );
    expect(result).toHaveLength(1);
  });

  it("follows method and callback locators, generic interfaces, and defaults", () => {
    write(
      "packages/features/widget/server/src/widget.api.ts",
      "export interface WidgetApi { read(): void }",
    );
    const result = findings(`
      import type { WidgetApi } from "../widget.api";
      interface Box<T = WidgetApi> { method(): T; callback: () => T }
      class WidgetApp { static create(setup: FeatureSetup<{}, Box, undefined>) { return setup } }
    `);
    expect(result).toHaveLength(2);
  });

  it("rejects a FeatureSetup binding from an unrelated module", () => {
    const result = findings(
      `
      interface WidgetService { run(): void }
      interface Infra { service: WidgetService }
      class WidgetApp { static create(setup: FakeSetup<{}, Infra, undefined>) { return setup } }
    `,
      `import type { FeatureSetup as FakeSetup } from "unrelated-module";`,
    );
    expect(result).toEqual([]);
  });

  it("does not retain parsed source files across lint invocations", () => {
    const first = findings(`
      interface WidgetService { run(): void }
      interface Infra { service: WidgetService }
      class WidgetApp { static create(setup: FeatureSetup<{}, Infra, undefined>) { return setup } }
    `);
    expect(first).toHaveLength(1);

    const second = findings(`
      class WidgetApp { static create(setup: FeatureSetup<{}, {}, undefined>) { return setup } }
    `);
    expect(second).toEqual([]);
  });
});
