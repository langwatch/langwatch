import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lintFeatureAppContracts } from "../src/policies/feature-app.ts";
import { createWorkspaceModuleResolver } from "../src/workspace/module-graph.ts";
import type { ClassifiedPackage, FeatureCatalogueEntry } from "../src/types.ts";
import { snapshotOf } from "./workspace.ts";

let root: string;
let packages: ClassifiedPackage[];
const contract = "packages/features/widget/contract";
const server = "packages/features/widget/server";
let catalogue: FeatureCatalogueEntry[];

function write(file: string, text: string): void {
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}
function findings() {
  return lintFeatureAppContracts(snapshotOf({ root, catalogue, packages }));
}
function install(kind: "legacy" | "defined" = "legacy", extra = ""): void {
  if (kind === "legacy") {
    write(
      `${server}/src/widget.server.ts`,
      `import { serverFeature } from "@langwatch/runtime-composition"; import { WidgetApi } from "@langwatch/widget-contract"; export const widgetServer = serverFeature("widget").withSetup(createApp).provides(WidgetApi).build();`,
    );
    return;
  }
  write(
    `${server}/src/widget.server.ts`,
    `import { defineFeature } from "@langwatch/runtime-composition"; import { WidgetApi, WidgetService } from "@langwatch/widget-contract"; export class ComposedWidgetApp implements WidgetApi { static readonly contract = WidgetApi; static readonly dependencies = {}; static readonly configSchema = undefined; private constructor(service: WidgetService) { this.#service = service; } #service: WidgetService; get() { return this.#service.get(); } ${extra} static create() { return new ComposedWidgetApp(service); } } export const widgetServer = defineFeature("widget").withApp(ComposedWidgetApp).build();`,
  );
}
function api(
  members = "get(): string;",
  helper = "@langwatch/runtime-composition",
  name = "widget",
): void {
  write(
    `${contract}/src/widget.api.ts`,
    `import { featureApi } from "${helper}"; export interface WidgetApi { ${members} } export const WidgetApi = featureApi<WidgetApi>("${name}");`,
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "feature-app-contract-"));
  catalogue = [
    {
      id: "widget",
      root: "packages/features/widget",
      classification: "core",
      subjects: ["widget"],
    },
  ];
  packages = (["contract", "server"] as const).map((kind) => {
    const directory = kind === "contract" ? contract : server;
    const manifest = { name: `@langwatch/widget-${kind}`, exports: { ".": "./src/index.ts" } };
    write(`${directory}/package.json`, JSON.stringify(manifest));
    return {
      name: manifest.name,
      root: join(root, directory),
      manifestPath: join(root, directory, "package.json"),
      manifest,
      kind,
      feature: "widget",
      layoutVersion: 0,
      enterprise: false,
    };
  });
  write(`${contract}/src/index.ts`, 'export { WidgetApi } from "./widget.api";');
  write(
    `${contract}/src/widget.service.ts`,
    "export abstract class WidgetService { abstract get(): string; }",
  );
  api();
  install();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("feature API contract lint", () => {
  it("rejects legacy serverFeature adoption", () => {
    expect(findings().some((item) => item.message.includes("Legacy serverFeature"))).toBe(true);
  });
  it("accepts the concrete app with callable operation and private service", () => {
    install("defined");
    expect(findings()).toEqual([]);
  });
  it("accepts static repository registration without exposing repositories on the API", () => {
    install("defined", "static readonly repositories = { rows: PrismaWidgetRepository };");
    expect(findings()).toEqual([]);
  });
  it("accepts repository installation before the canonical app stage", () => {
    install("defined");
    const file = `${server}/src/widget.server.ts`;
    write(
      file,
      readFileSync(join(root, file), "utf8").replace(
        'defineFeature("widget").withApp',
        'defineFeature("widget").withRepositories(WidgetRepositories).withApp',
      ),
    );

    expect(findings()).toEqual([]);
  });
  it("rejects repository registration exposed on the App instance", () => {
    install("defined", "readonly repositories = { rows: PrismaWidgetRepository };");
    expect(findings().some((item) => item.message.includes("different public surface"))).toBe(true);
  });
  it.each(["constructor", "public constructor", "protected constructor"])(
    "rejects externally accessible construction through %s",
    (constructor) => {
      install("defined");
      const file = `${server}/src/widget.server.ts`;
      write(
        file,
        readFileSync(join(root, file), "utf8").replace("private constructor", constructor),
      );

      expect(findings().some((item) => item.message.includes("explicit private constructor"))).toBe(
        true,
      );
    },
  );
  it("rejects an implicit public constructor", () => {
    install("defined");
    const file = `${server}/src/widget.server.ts`;
    write(
      file,
      readFileSync(join(root, file), "utf8").replace(
        "private constructor(service: WidgetService) { this.#service = service; }",
        "",
      ),
    );

    expect(findings().some((item) => item.message.includes("explicit private constructor"))).toBe(
      true,
    );
  });
  it.each([
    "setup: FeatureSetup<{}, {}, undefined> | LegacyDependencies",
    "setup: FeatureSetup<{}, {}, undefined> & LegacyDependencies",
    "setup: LegacyDependencies",
    "setup: any",
    "setup: unknown",
    "setup?: FeatureSetup<{}, {}, undefined>",
    "setup: FeatureSetup<{}, {}, undefined> = fallback",
    "...setup: FeatureSetup<{}, {}, undefined>[]",
    "setup: FeatureSetup<{}, {}, undefined>, legacy: LegacyDependencies",
  ])("rejects the alternate factory input %s", (parameter) => {
    install("defined");
    const file = `${server}/src/widget.server.ts`;
    write(
      file,
      `import type { FeatureSetup } from "@langwatch/runtime-composition"; ${readFileSync(join(root, file), "utf8").replace("static create()", `static create(${parameter})`)}`,
    );

    expect(findings().some((item) => item.message.includes("noncanonical construction path"))).toBe(
      true,
    );
  });
  it.each([
    [
      "import type { FeatureSetup } from '@langwatch/runtime-composition';",
      "{ infrastructure }: FeatureSetup<{}, {}, undefined>",
    ],
    [
      "import type { FeatureSetup as Setup } from '@langwatch/runtime-composition'; type Input = Setup<{}, {}, undefined>;",
      "setup: Input",
    ],
    [
      "import type * as Runtime from '@langwatch/runtime-composition';",
      "setup: Runtime.FeatureSetup<{}, {}, undefined>",
    ],
  ])("accepts canonical factory input through %s", (prefix, parameter) => {
    install("defined");
    const file = `${server}/src/widget.server.ts`;
    write(
      file,
      `${prefix} ${readFileSync(join(root, file), "utf8").replace("static create()", `static create(${parameter})`)}`,
    );

    expect(findings()).toEqual([]);
  });
  it("rejects legacy union inputs hidden behind a type alias", () => {
    install("defined");
    const file = `${server}/src/widget.server.ts`;
    const prefix =
      "import type { FeatureSetup } from '@langwatch/runtime-composition'; type Input = FeatureSetup<{}, {}, undefined> | LegacyDependencies;";
    write(
      file,
      `${prefix} ${readFileSync(join(root, file), "utf8").replace("static create()", "static create(setup: Input)")}`,
    );

    expect(findings().some((item) => item.message.includes("noncanonical construction path"))).toBe(
      true,
    );
  });
  it.each([
    ["FeatureSetup<{}, {}, undefined>", false],
    ["FeatureSetup<{}, {}, undefined> | LegacyDependencies", true],
  ])("resolves imported factory type aliases with body %s", (body, rejected) => {
    install("defined");
    write(
      `${server}/src/setup.ts`,
      `import type { FeatureSetup } from '@langwatch/runtime-composition'; export type Setup = ${body};`,
    );
    const file = `${server}/src/widget.server.ts`;
    write(
      file,
      `import type { Setup as Input } from './setup.ts'; ${readFileSync(join(root, file), "utf8").replace("static create()", "static create(setup: Input)")}`,
    );

    expect(findings().some((item) => item.message.includes("noncanonical construction path"))).toBe(
      rejected,
    );
  });
  it("rejects a public constructor overload even with a private implementation", () => {
    install("defined");
    const file = `${server}/src/widget.server.ts`;
    write(
      file,
      readFileSync(join(root, file), "utf8").replace(
        "private constructor",
        "constructor(service: WidgetService); private constructor",
      ),
    );

    expect(findings().some((item) => item.message.includes("explicit private constructor"))).toBe(
      true,
    );
  });
  it("rejects a locally named imitation of FeatureSetup", () => {
    install("defined");
    const file = `${server}/src/widget.server.ts`;
    write(
      file,
      `type FeatureSetup = { infrastructure: object }; ${readFileSync(join(root, file), "utf8").replace("static create()", "static create(setup: FeatureSetup)")}`,
    );

    expect(findings().some((item) => item.message.includes("noncanonical construction path"))).toBe(
      true,
    );
  });
  it.each([
    ["type Input<FeatureSetup> = FeatureSetup;", "static create(setup: Input<{ legacy: string }>)"],
    ["", "static create<FeatureSetup>(setup: FeatureSetup)"],
  ])("rejects type parameters shadowing the canonical setup import %s", (alias, factory) => {
    install("defined");
    const file = `${server}/src/widget.server.ts`;
    const prefix = `import type { FeatureSetup } from '@langwatch/runtime-composition'; ${alias}`;
    write(
      file,
      `${prefix} ${readFileSync(join(root, file), "utf8").replace("static create()", factory)}`,
    );

    expect(findings().some((item) => item.message.includes("noncanonical construction path"))).toBe(
      true,
    );
  });
  it("checks legacy overloads even when the implementation uses canonical setup", () => {
    install("defined");
    const file = `${server}/src/widget.server.ts`;
    const prefix = "import type { FeatureSetup } from '@langwatch/runtime-composition';";
    write(
      file,
      `${prefix} ${readFileSync(join(root, file), "utf8").replace("static create()", "static create(setup: LegacyDependencies): ComposedWidgetApp; static create(setup: FeatureSetup<{}, {}, undefined>)")}`,
    );

    expect(findings().some((item) => item.message.includes("noncanonical construction path"))).toBe(
      true,
    );
  });
  it.each(["readonly service: unknown;", "get?: () => string;", "[key: string]: string;"])(
    "rejects non-callable API member %s",
    (member) => {
      api(member);
      expect(findings().some((item) => item.message.includes("callable operations only"))).toBe(
        true,
      );
    },
  );
  it("rejects a helper imported from anywhere but the composition root", () => {
    api("get(): string;", "@langwatch/runtime-composition/contract");
    expect(findings().some((item) => item.message.includes("canonical featureApi token"))).toBe(
      true,
    );
  });
  it("rejects a token with the wrong feature name", () => {
    api("get(): string;", "@langwatch/runtime-composition", "other");
    expect(findings().some((item) => item.message.includes("canonical featureApi token"))).toBe(
      true,
    );
  });
  it("rejects a local helper shadowing featureApi", () => {
    write(
      `${contract}/src/widget.api.ts`,
      `const featureApi = <T>(name: string) => ({ name }); export interface WidgetApi { get(): string; } export const WidgetApi = featureApi<WidgetApi>("widget");`,
    );
    expect(findings().some((item) => item.message.includes("canonical featureApi token"))).toBe(
      true,
    );
  });
  it("requires both API declarations from the contract barrel", () => {
    write(`${contract}/src/index.ts`, 'export type { WidgetApi } from "./widget.api";');
    expect(
      findings().some((item) => item.message.includes("not exported from the contract root")),
    ).toBe(true);
  });
  it("accepts a peer API token through a barrel and local dependency alias", () => {
    catalogue.push({
      id: "peer",
      root: "packages/features/peer",
      classification: "core",
      subjects: ["peer"],
    });
    write(
      "packages/features/peer/contract/src/peer.api.ts",
      'import { featureApi } from "@langwatch/runtime-composition"; export interface PeerApi { ping(): void; } export const PeerApi = featureApi<PeerApi>("peer");',
    );
    write("packages/features/peer/contract/src/index.ts", 'export { PeerApi } from "./peer.api";');
    write(
      "packages/features/peer/contract/package.json",
      JSON.stringify({ name: "@langwatch/peer-contract", exports: { ".": "./src/index.ts" } }),
    );
    packages.push({
      name: "@langwatch/peer-contract",
      root: join(root, "packages/features/peer/contract"),
      manifestPath: join(root, "packages/features/peer/contract/package.json"),
      manifest: { name: "@langwatch/peer-contract", exports: { ".": "./src/index.ts" } },
      kind: "contract",
      feature: "peer",
      enterprise: false,
      layoutVersion: 0,
    });
    write(
      `${server}/src/widget.server.ts`,
      `import { defineFeature } from "@langwatch/runtime-composition"; import { WidgetApi, WidgetService } from "@langwatch/widget-contract"; import { PeerApi as OtherApi } from "../../../peer/contract/src/index"; const dependencies = { peer: OtherApi }; export class ComposedWidgetApp implements WidgetApi { static readonly contract = WidgetApi; static readonly dependencies = dependencies; static readonly configSchema = undefined; private constructor(service: WidgetService) { this.#service = service; } #service: WidgetService; get() { return this.#service.get(); } static create() { return new ComposedWidgetApp(service); } } export const widgetServer = defineFeature("widget").withApp(ComposedWidgetApp).build();`,
    );
    expect(findings()).toEqual([]);
  });
  it.each(["WidgetService", "() => ({})", "WidgetApi"])(
    "rejects non-peer API dependency %s",
    (value) => {
      install("defined");
      const file = join(root, server, "src/widget.server.ts");
      write(
        `${server}/src/widget.server.ts`,
        readFileSync(file, "utf8").replace(
          "static readonly dependencies = {};",
          `static readonly dependencies = { peer: ${value} };`,
        ),
      );
      expect(findings().some((item) => item.message.includes("defineFeature installer"))).toBe(
        true,
      );
    },
  );
  it.each([
    'get: WidgetApi["get"] = () => this.#service.get();',
    'get = function() { return "value"; };',
  ])("accepts a declared callable field %s", (operation) => {
    install("defined");
    const file = join(root, server, "src/widget.server.ts");
    write(
      `${server}/src/widget.server.ts`,
      readFileSync(file, "utf8").replace("get() { return this.#service.get(); }", operation),
    );
    expect(findings()).toEqual([]);
  });
  it.each([
    "get = service.get;",
    "get?: () => string;",
    "get: () => string;",
    'get get() { return () => "value"; }',
    "get = service;",
    'helper = () => "value";',
  ])("rejects an opaque or undeclared callable field %s", (operation) => {
    install("defined");
    const file = join(root, server, "src/widget.server.ts");
    write(
      `${server}/src/widget.server.ts`,
      readFileSync(file, "utf8").replace("get() { return this.#service.get(); }", operation),
    );
    expect(findings().some((item) => item.message.includes("different public surface"))).toBe(true);
  });
  it("accepts overloads of one public operation", () => {
    api("get(id: string): string; get(id: number): string;");
    install("defined");
    expect(findings()).toEqual([]);
  });
  it("rejects a leaking overload even when another signature is valid", () => {
    api("get(id: string): string; get(id: number): WidgetService;");
    install("defined");
    expect(findings().some((item) => item.message.includes("callable operations only"))).toBe(true);
  });
  it("rejects a public helper method outside the API", () => {
    install("defined", "helper() { return this.#service.get(); }");
    expect(findings().some((item) => item.message.includes("different public surface"))).toBe(true);
  });
  it("rejects a public service field", () => {
    install("defined", "readonly leaked = this.service;");
    expect(findings().some((item) => item.message.includes("different public surface"))).toBe(true);
  });
  it("accepts ECMAScript private implementation state", () => {
    install("defined", "#helper() { return this.#service.get(); }");
    expect(findings()).toEqual([]);
  });
  it("rejects TypeScript private implementation state", () => {
    install("defined", "private helper() { return this.#service.get(); }");
    expect(findings().some((item) => item.message.includes("different public surface"))).toBe(true);
  });
  it("rejects inherited app implementation members", () => {
    install("defined");
    const file = join(root, server, "src/widget.server.ts");
    write(
      `${server}/src/widget.server.ts`,
      readFileSync(file, "utf8").replace(
        "implements WidgetApi",
        "extends BaseApp implements WidgetApi",
      ),
    );
    expect(findings().some((item) => item.message.includes("defineFeature installer"))).toBe(true);
  });
  it.each(["then", '"then"', '["then"]', "constructor", '"prototype"', '"__proto__"'])(
    "rejects reserved API operation name %s",
    (name) => {
      api(`${name}(): void;`);
      expect(findings().some((item) => item.message.includes("callable operations only"))).toBe(
        true,
      );
    },
  );
  it("allows an explicit toString API operation", () => {
    api("toString(): string;");
    install("defined");
    const file = join(root, server, "src/widget.server.ts");
    write(
      `${server}/src/widget.server.ts`,
      readFileSync(file, "utf8").replace(
        "get() { return this.#service.get(); }",
        "toString() { return this.#service.get(); }",
      ),
    );
    expect(findings()).toEqual([]);
  });
  it.each([
    "get(): Promise<WidgetService>;",
    "type ServiceAlias = WidgetService; get(): ServiceAlias;",
  ])("rejects service return leakage through %s", (members) => {
    api(members);
    expect(findings().some((item) => item.message.includes("callable operations only"))).toBe(true);
  });
  it("requires a canonical API module for every catalogue owner", () => {
    rmSync(join(root, contract, "src/widget.api.ts"));
    expect(findings().some((item) => item.message.includes("canonical API contract"))).toBe(true);
  });
  it("rejects an app that extends instead of implements the API", () => {
    install("defined");
    const file = join(root, server, "src/widget.server.ts");
    write(
      `${server}/src/widget.server.ts`,
      readFileSync(file, "utf8").replace("implements WidgetApi", "extends WidgetApi"),
    );
    expect(findings().some((item) => item.message.includes("defineFeature installer"))).toBe(true);
  });
});
