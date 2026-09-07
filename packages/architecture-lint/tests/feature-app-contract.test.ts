import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lintFeatureAppContracts } from "../src/feature-app-contract.ts";
import { createWorkspaceModuleResolver } from "../src/module-graph.ts";
import type { ClassifiedPackage, FeatureCatalogueEntry } from "../src/types.ts";

let root: string;
let packages: ClassifiedPackage[];
let catalogue: FeatureCatalogueEntry[];
const contract = "packages/features/widget/contract";
const server = "packages/features/widget/server";

function write(file: string, text: string): void {
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

function findings() {
  return lintFeatureAppContracts(
    root,
    catalogue,
    packages,
    createWorkspaceModuleResolver({ root }),
  );
}

function install(provider = ".provides(WidgetApp)"): void {
  write(
    `${server}/src/widget.server.ts`,
    `
    import { serverFeature as feature } from "@langwatch/runtime-composition";
    import { WidgetApp } from "@langwatch/widget-contract";
    export const widgetServer = feature("widget").withSetup(createApp)${provider}.build();
  `,
  );
}

function installDefined(appClass = "ComposedWidgetApp", name = "widget"): void {
  write(
    `${server}/src/widget.server.ts`,
    `
    import { defineFeature as feature } from "@langwatch/runtime-composition";
    import { WidgetApp, WidgetService } from "@langwatch/widget-contract";
    export class ${appClass} extends WidgetApp {
      static readonly contract = WidgetApp;
      static readonly dependencies = {};
      static readonly configSchema = undefined;
      private constructor(readonly widgets: WidgetService) { super(); }
      static create() { return new ${appClass}(service); }
    }
    export const widgetServer = feature("${name}").withApp(${appClass}).build();
  `,
  );
}

function app(members = "abstract readonly widgets: WidgetService;"): void {
  write(
    `${contract}/src/widget.app.ts`,
    `
    import type { WidgetService } from "./widget.service";
    export abstract class WidgetApp { ${members} }
  `,
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
  write(
    `${contract}/src/widget.service.ts`,
    "export abstract class WidgetService { abstract get(): string; }",
  );
  write(`${contract}/src/index.ts`, 'export { WidgetApp } from "./widget.app";');
  app();
  install();
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("feature app registration", () => {
  it("accepts the canonical app and one provider through an aliased installer import", () => {
    expect(findings()).toEqual([]);
  });

  it("accepts the canonical defineFeature app shape", () => {
    installDefined();
    expect(findings()).toEqual([]);
  });

  it("resolves app metadata from its own module and accepts API contributions", () => {
    write(
      `${server}/src/app/widget.app.ts`,
      `import { WidgetApp as Contract } from "@langwatch/widget-contract";
       import type { WidgetService } from "@langwatch/widget-contract";
       export class WidgetApp extends Contract {
         static readonly contract = Contract;
         static readonly dependencies = {};
         private constructor(readonly widgets: WidgetService) { super(); }
         static create() { return new WidgetApp(service); }
       }`,
    );
    write(
      `${server}/src/widget.server.ts`,
      `import { defineFeature } from "@langwatch/runtime-composition";
       import { WidgetApp } from "./app/widget.app";
       export const widgetServer = defineFeature("widget")
         .withApp(WidgetApp).withTransports(restApi, trpcApi).build();`,
    );
    expect(findings()).toEqual([]);
  });

  it("reports a missing contract for a defined feature without crashing the audit", () => {
    installDefined();
    rmSync(join(root, contract, "src/widget.app.ts"));
    expect(findings().some((item) => item.message.includes("canonical app contract"))).toBe(true);
  });

  it.each([".withApp(ComposedWidgetApp)", ".withTransports(rest).withTransports(trpc)"])(
    "rejects repeated definition stages: %s",
    (extra) => {
      installDefined();
      const file = `${server}/src/widget.server.ts`;
      write(file, readFileSync(join(root, file), "utf8").replace(".build()", `${extra}.build()`));
      expect(findings().some((item) => item.message.includes("defineFeature installer"))).toBe(
        true,
      );
    },
  );

  it.each([
    ["wrong contract token", "static readonly contract = WidgetService;"],
    ["mutable metadata", "static contract = WidgetApp;"],
  ])("rejects %s in a defineFeature app", (_label, metadata) => {
    installDefined();
    write(
      `${server}/src/widget.server.ts`,
      readFileSync(join(root, server, "src/widget.server.ts"), "utf8").replace(
        "static readonly contract = WidgetApp;",
        metadata,
      ),
    );
    expect(findings().some((item) => item.message.includes("defineFeature installer"))).toBe(true);
  });

  it("rejects the wrong feature name and legacy stages on defineFeature", () => {
    installDefined("ComposedWidgetApp", "other");
    expect(findings().some((item) => item.message.includes("canonical feature name"))).toBe(true);
    write(
      `${server}/src/widget.server.ts`,
      readFileSync(join(root, server, "src/widget.server.ts"), "utf8").replace(
        ".withApp(ComposedWidgetApp)",
        ".withSetup(createApp).withApp(ComposedWidgetApp)",
      ),
    );
    expect(findings().some((item) => item.message.includes("defineFeature installer"))).toBe(true);
  });

  it("reports missing apps and installers independently for unconverted features", () => {
    rmSync(join(root, server, "src/widget.server.ts"));
    rmSync(join(root, contract, "src/widget.app.ts"));
    expect(findings().map((item) => item.message)).toEqual([
      "Every catalogue feature requires its canonical app contract.",
      'Catalogue feature "widget" has no canonical server installer.',
    ]);
  });

  it("requires the app as soon as the installer is adopted", () => {
    rmSync(join(root, contract, "src/widget.app.ts"));
    expect(findings()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Every catalogue feature requires its canonical app contract.",
        }),
      ]),
    );
  });

  it.each([
    ["mutable", "abstract widgets: WidgetService;"],
    ["optional", "abstract readonly widgets?: WidgetService;"],
    ["forwarding method", "abstract get(): string;"],
    ["callback bag", "abstract readonly widgets: { get(): string };"],
    ["partial service", 'abstract readonly widgets: Pick<WidgetService, "get">;'],
    ["repository", "abstract readonly repository: WidgetRepository;"],
    ["infrastructure", "abstract readonly prisma: PrismaClient;"],
    ["transport", "abstract readonly router: WidgetRouter;"],
  ])("rejects a %s member", (_label, members) => {
    app(members);
    expect(findings()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message:
            "A feature app member is not an abstract readonly service owned by this feature.",
          allowed: expect.stringContaining("dev/docs/adr/133-composition-spec.md"),
        }),
      ]),
    );
  });

  it("rejects a real service imported from another feature", () => {
    write(
      "packages/features/foreign/contract/package.json",
      JSON.stringify({ name: "@langwatch/foreign-contract", exports: { ".": "./src/index.ts" } }),
    );
    write(
      "packages/features/foreign/contract/src/index.ts",
      'export { ForeignService } from "./foreign.service";',
    );
    write(
      "packages/features/foreign/contract/src/foreign.service.ts",
      "export abstract class ForeignService {}",
    );
    write(
      `${contract}/src/widget.app.ts`,
      'import type { ForeignService } from "@langwatch/foreign-contract"; export abstract class WidgetApp { abstract readonly foreign: ForeignService; }',
    );
    expect(
      findings().some((item) => item.message.includes("not an abstract readonly service")),
    ).toBe(true);
  });

  it.each([
    "",
    ".provides(WidgetApp, app => app)",
    ".provides(WidgetApp).provides(WidgetApp)",
    ".provides(WidgetService)",
  ])("rejects invalid provider declaration %s", (provider) => {
    install(provider);
    expect(findings()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "A feature installer must provide its own app exactly once, without a selector.",
        }),
      ]),
    );
  });

  it("requires a value export from the contract barrel", () => {
    write(`${contract}/src/index.ts`, 'export type { WidgetApp } from "./widget.app";');
    expect(findings().some((item) => item.message.includes("not value-exported"))).toBe(true);
  });

  it("rejects an inherited app that hides services outside its canonical declaration", () => {
    write(`${contract}/src/widget.app.ts`, "export abstract class WidgetApp extends OtherApp {}");
    expect(findings().some((item) => item.message.includes("without inheritance"))).toBe(true);
  });

  it("rejects a second app module", () => {
    write(`${contract}/src/other.app.ts`, "export abstract class OtherApp {}");
    expect(findings().some((item) => item.message.includes("more than one app module"))).toBe(true);
  });
});

describe("installer declaration visibility", () => {
  it("checks namespace-imported installers", () => {
    write(
      `${server}/src/widget.server.ts`,
      `
      import * as composition from "@langwatch/runtime-composition";
      import { WidgetApp } from "@langwatch/widget-contract";
      export const widgetServer = composition.serverFeature("widget").withSetup(createApp).provides(WidgetApp).build();
    `,
    );
    expect(findings()).toEqual([]);
    rmSync(join(root, contract, "src/widget.app.ts"));
    expect(findings().some((item) => item.message.includes("requires its canonical app"))).toBe(
      true,
    );
  });

  it("rejects providers added through a split builder", () => {
    write(
      `${server}/src/widget.server.ts`,
      `
      import { serverFeature } from "@langwatch/runtime-composition";
      import { WidgetApp } from "@langwatch/widget-contract";
      const builder = serverFeature("widget").withSetup(createApp).provides(WidgetApp);
      export const widgetServer = builder.provides(OtherApp).build();
    `,
    );
    expect(findings().some((item) => item.message.includes("split across declarations"))).toBe(
      true,
    );
  });
});

describe("concrete app public surface", () => {
  it.each([
    ["readonly contract services", "", "readonly widgets: WidgetService", false],
    [
      "private implementation detail",
      "private cache = new Map();",
      "readonly widgets: WidgetService",
      false,
    ],
    [
      "public repository",
      "readonly repository = repository;",
      "readonly widgets: WidgetService",
      true,
    ],
    [
      "forwarding method",
      "get() { return this.widgets.get(); }",
      "readonly widgets: WidgetService",
      true,
    ],
    [
      "constructor repository",
      "",
      "readonly widgets: WidgetService, readonly repository: WidgetRepository",
      true,
    ],
    ["mutable service", "", "public widgets: WidgetService", true],
    ["getter", "get widgets() { return service; }", "", true],
  ])("checks %s", (_label, members, parameters, rejected) => {
    write(
      `${server}/src/app/widget.app.ts`,
      `
      import { WidgetApp } from "@langwatch/widget-contract";
      export class ComposedWidgetApp extends WidgetApp {
        private constructor(${parameters}) { super(); }
        static create() { return new ComposedWidgetApp(service); }
        ${members}
      }
    `,
    );
    expect(findings().some((item) => item.message.includes("different public surface"))).toBe(
      rejected,
    );
  });
});

it("rejects hiding the canonical installer behind a local factory alias", () => {
  write(
    `${server}/src/widget.server.ts`,
    `
    import { serverFeature } from "@langwatch/runtime-composition";
    const hidden = serverFeature;
    export const widgetServer = hidden("widget").withSetup(createApp).provides(WidgetApp).build();
  `,
  );
  expect(findings().some((item) => item.message.includes("hides its serverFeature"))).toBe(true);
});

it("rejects infrastructure on a concrete app implementing the contract", () => {
  write(
    `${server}/src/app/widget.app.ts`,
    `
    import { WidgetApp } from "@langwatch/widget-contract";
    export class ComposedWidgetApp implements WidgetApp {
      private constructor(readonly widgets: WidgetService, readonly prisma: PrismaClient) {}
      static create() { return new ComposedWidgetApp(service, database); }
    }
  `,
  );
  expect(findings()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        message: "A concrete feature app exposes a different public surface from its contract.",
      }),
    ]),
  );
});

describe("catalogue-wide enforcement", () => {
  it("reports a catalogue owner even when none of its packages exist", () => {
    catalogue.push({
      id: "missing",
      root: "packages/features/missing",
      classification: "core",
      subjects: ["missing"],
    });
    expect(findings().map((item) => item.message)).toEqual([
      'Catalogue feature "missing" has no portable contract package.',
      "Every catalogue feature requires its canonical app contract.",
    ]);
  });

  it("does not exempt packages without a strict-layout marker", () => {
    for (const pkg of packages) delete pkg.layoutVersion;
    rmSync(join(root, contract, "src/widget.app.ts"));
    expect(findings().map((item) => item.message)).toEqual([
      "Every catalogue feature requires its canonical app contract.",
      "A feature installer must provide its own app exactly once, without a selector.",
    ]);
  });

  it("requires real browser contracts without requiring a server", () => {
    packages = packages.filter((pkg) => pkg.kind === "contract");
    expect(findings()).toEqual([]);
    rmSync(join(root, contract, "src/widget.app.ts"));
    expect(findings().map((item) => item.message)).toEqual([
      "Every catalogue feature requires its canonical app contract.",
    ]);
    packages = [];
    expect(findings().map((item) => item.message)).toEqual([
      'Catalogue feature "widget" has no portable contract package.',
      "Every catalogue feature requires its canonical app contract.",
    ]);
  });

  it("applies the same app and installer requirements to Enterprise owners", () => {
    catalogue = [
      {
        id: "licensed",
        root: "packages/enterprise/features/licensed",
        classification: "enterprise",
        subjects: ["licensed"],
      },
    ];
    const enterpriseRoot = join(root, "packages/enterprise/features/licensed/server");
    packages.push({
      name: "@langwatch/licensed-server",
      root: enterpriseRoot,
      manifestPath: join(enterpriseRoot, "package.json"),
      manifest: {},
      kind: "server",
      feature: "licensed",
      enterprise: true,
    });
    expect(findings().map((item) => item.message)).toEqual([
      'Catalogue feature "licensed" has no portable contract package.',
      "Every catalogue feature requires its canonical app contract.",
      'Catalogue feature "licensed" has no canonical server installer.',
    ]);
  });
});

it("checks concrete browser app leakage without introducing a server", () => {
  const web = "packages/features/widget/web";
  packages = packages.filter((pkg) => pkg.kind === "contract");
  packages.push({
    name: "@langwatch/widget-web",
    root: join(root, web),
    manifestPath: join(root, web, "package.json"),
    manifest: {},
    kind: "web",
    feature: "widget",
    enterprise: false,
  });
  write(
    `${web}/src/widget.app.ts`,
    `
    import { WidgetApp } from "@langwatch/widget-contract";
    export class BrowserWidgetApp extends WidgetApp {
      readonly widgets: WidgetService;
      get() { return this.widgets.get(); }
    }
  `,
  );
  expect(findings().map((item) => item.message)).toEqual([
    "A concrete feature app exposes a different public surface from its contract.",
  ]);
});
