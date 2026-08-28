import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lintFrontendUiBoundaries } from "../src";
import type { ClassifiedPackage } from "../src";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-frontend-ui-boundaries-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function writeCatalogue(
  features: Array<{
    id: string;
    root?: string;
    screens?: string[];
    surfaces?: string[];
  }>,
  governedWebPackages?: string[],
): void {
  const declaredCapabilities = features.flatMap((feature) => [
    ...(feature.screens ?? []),
    ...(feature.surfaces ?? []),
  ]);
  const inferredWebPackages = declaredCapabilities.map((specifier) =>
    specifier.split("/").slice(0, 2).join("/"),
  );
  write(
    "apps/ui/src/features/catalogue.json",
    JSON.stringify({
      version: 0,
      governedWebPackages: governedWebPackages ?? [...new Set(inferredWebPackages)],
      features: features.map((feature) => ({
        id: feature.id,
        root: feature.root ?? feature.id,
        uses: {
          screens: feature.screens ?? [],
          surfaces: feature.surfaces ?? [],
        },
      })),
    }),
  );
}

function webPackage(feature: string, exports: Record<string, string>): ClassifiedPackage {
  const packageRoot = `packages/features/${feature}/web`;
  write(
    `${packageRoot}/package.json`,
    JSON.stringify({
      name: `@langwatch/${feature}-web`,
      type: "module",
      exports,
    }),
  );
  return {
    name: `@langwatch/${feature}-web`,
    root: join(root, packageRoot),
    manifestPath: join(root, packageRoot, "package.json"),
    manifest: {
      name: `@langwatch/${feature}-web`,
      exports,
    },
    kind: "web",
    feature,
    featureRoot: join(root, `packages/features/${feature}`),
    enterprise: false,
  };
}

function writeWebFeature(feature: string, name: string, dependencies: string[] = []): void {
  write(
    `packages/features/${feature}/web/src/features/${name}/feature.json`,
    JSON.stringify({ version: 0, dependencies }),
  );
}

function lint(packages: ClassifiedPackage[]): ReturnType<typeof lintFrontendUiBoundaries> {
  return lintFrontendUiBoundaries(root, packages);
}

function policies(packages: ClassifiedPackage[]): string[] {
  return lint(packages).map((violation) => violation.policy);
}

describe("frontend UI architecture boundaries", () => {
  it("is inert until the UI feature catalogue exists", () => {
    write("apps/ui/src/components/legacy.tsx", "export const Legacy = true;");
    write("apps/ui/src/anything.ts", 'import { PrismaClient } from "@prisma/client";');

    expect(lint([])).toEqual([]);
  });

  it("accepts declared owner screens and declared cross-feature surfaces", () => {
    const promptWeb = webPackage("prompt", {
      "./screens/prompt-studio": "./src/screens/prompt-studio/index.ts",
      "./surfaces/prompt-reference": "./src/surfaces/prompt-reference/index.ts",
    });
    writeCatalogue([
      {
        id: "prompt-studio",
        screens: ["@langwatch/prompt-web/screens/prompt-studio"],
      },
      {
        id: "trace-explorer",
        surfaces: ["@langwatch/prompt-web/surfaces/prompt-reference"],
      },
    ]);
    write(
      "apps/ui/src/features/prompt-studio/index.ts",
      'import { PromptStudio } from "@langwatch/prompt-web/screens/prompt-studio"; export { PromptStudio };',
    );
    write(
      "apps/ui/src/features/trace-explorer/index.ts",
      'import { PromptReference } from "@langwatch/prompt-web/surfaces/prompt-reference"; export { PromptReference };',
    );
    write(
      "packages/features/prompt/web/src/screens/prompt-studio/index.ts",
      'export { PromptStudio } from "./private";',
    );
    write(
      "packages/features/prompt/web/src/screens/prompt-studio/private/index.ts",
      "export const PromptStudio = true;",
    );
    write(
      "packages/features/prompt/web/src/surfaces/prompt-reference/index.ts",
      'export { PromptReference } from "./view";',
    );
    write(
      "packages/features/prompt/web/src/surfaces/prompt-reference/view/index.ts",
      "export const PromptReference = true;",
    );

    expect(lint([promptWeb])).toEqual([]);
  });

  it("governs an opted-in web package before a frontend feature owns its screen", () => {
    const promptWeb = webPackage("prompt", {
      ".": "./src/index.ts",
      "./surfaces/prompt-reference": "./src/surfaces/prompt-reference/index.ts",
    });
    writeCatalogue([], ["@langwatch/prompt-web"]);
    write("packages/features/prompt/web/src/index.ts", "export {};");
    write(
      "packages/features/prompt/web/src/surfaces/prompt-reference/index.ts",
      "export const PromptReference = true;",
    );

    expect(policies([promptWeb])).toContain("ui-web-public-entry");
  });

  it("rejects capabilities from a web package that has not opted into governance", () => {
    const promptWeb = webPackage("prompt", {
      "./screens/prompt-studio": "./src/screens/prompt-studio/index.ts",
    });
    writeCatalogue(
      [
        {
          id: "prompt-studio",
          screens: ["@langwatch/prompt-web/screens/prompt-studio"],
        },
      ],
      [],
    );
    write(
      "apps/ui/src/features/prompt-studio/route.ts",
      'import "@langwatch/prompt-web/screens/prompt-studio";',
    );
    write("packages/features/prompt/web/src/screens/prompt-studio/index.ts", "export {};");

    expect(
      policies([promptWeb]).filter((policy) => policy === "ui-web-package-governance"),
    ).toHaveLength(2);
  });

  it("requires the frontend feature catalogue and prevents root catch-all directories", () => {
    writeCatalogue([{ id: "prompt-studio" }]);
    write("apps/ui/src/components/prompt-card.tsx", "export const PromptCard = true;");
    write("apps/ui/src/arbitrary/prompt-card.tsx", "export const PromptCard = true;");
    write("apps/ui/src/loose.ts", "export const loose = true;");
    write("apps/ui/src/app/bootstrap.ts", "export const bootstrap = true;");
    write("apps/ui/src/features/unlisted/route.tsx", "export const Route = true;");

    expect(policies([])).toEqual(
      expect.arrayContaining(["ui-root-catch-all", "ui-feature-catalogue"]),
    );
    expect(policies([]).filter((policy) => policy === "ui-root-catch-all")).toHaveLength(4);
  });

  it("enforces global, screen, and frontend feature dependency direction", () => {
    writeCatalogue([{ id: "prompt-studio" }, { id: "trace-explorer" }]);
    write("apps/ui/src/behavior/api/client.ts", 'import "../../features/prompt-studio/route";');
    write(
      "apps/ui/src/features/prompt-studio/route.ts",
      'import "../../screens/router"; import "../trace-explorer/route";',
    );
    write("apps/ui/src/features/trace-explorer/route.ts", 'import "../prompt-studio/route";');
    write("apps/ui/src/screens/router.ts", "export const router = true;");

    expect(policies([])).toEqual(
      expect.arrayContaining([
        "ui-dependency-direction",
        "ui-feature-implementation-import",
        "ui-feature-cycle",
      ]),
    );
  });

  it("keeps global layers and private features below composition boundaries", () => {
    writeCatalogue([{ id: "prompt-studio" }]);
    write(
      "apps/ui/src/model/model.ts",
      'import "../features/prompt-studio/route"; import "../screens/prompt";',
    );
    write(
      "apps/ui/src/behavior/behavior.ts",
      'import "../features/prompt-studio/route"; import "../surfaces/prompt";',
    );
    write(
      "apps/ui/src/ui/elements/element.ts",
      'import "../../features/prompt-studio/route"; import "../../screens/prompt";',
    );
    write("apps/ui/src/features/prompt-studio/route.ts", 'import "../../screens/prompt";');
    write("apps/ui/src/screens/prompt.ts", "export const PromptScreen = true;");
    write("apps/ui/src/surfaces/prompt.ts", "export const PromptSurface = true;");

    expect(policies([]).filter((policy) => policy === "ui-dependency-direction")).toHaveLength(7);
  });

  it("enforces dependency direction between global model, behavior, and UI layers", () => {
    writeCatalogue([{ id: "agent-management" }]);
    write(
      "apps/ui/src/model/model.ts",
      'import "../behavior/behavior"; import "../ui/elements/element";',
    );
    write(
      "apps/ui/src/behavior/behavior.ts",
      'import "../ui/elements/element"; import "../ui/blocks/block"; import "../model/model";',
    );
    write(
      "apps/ui/src/ui/elements/element.ts",
      'import "../../behavior/behavior"; import "../blocks/block"; import "../../model/model";',
    );
    write(
      "apps/ui/src/ui/blocks/block.ts",
      'import "../sections/section"; import "../elements/element";',
    );
    write(
      "apps/ui/src/ui/sections/section.ts",
      'import "../blocks/block"; import "../../behavior/behavior";',
    );

    expect(policies([]).filter((policy) => policy === "ui-dependency-direction")).toHaveLength(7);
  });

  it("requires global presentation to use an atomic UI layer", () => {
    writeCatalogue([{ id: "agent-management" }]);
    write("apps/ui/src/ui/loose.ts", "export const loose = true;");
    write("apps/ui/src/ui/cards/card.ts", "export const card = true;");
    write("apps/ui/src/ui/elements/element.ts", "export const element = true;");
    write("apps/ui/src/ui/blocks/block.ts", "export const block = true;");
    write("apps/ui/src/ui/sections/section.ts", "export const section = true;");

    expect(policies([]).filter((policy) => policy === "ui-global-layout")).toHaveLength(2);
  });

  it("requires private features to use model, behavior, and layered ui roots", () => {
    writeCatalogue([{ id: "agent-management" }]);
    write("apps/ui/src/features/agent-management/route.ts", "export const route = true;");
    write("apps/ui/src/features/agent-management/model/model.ts", 'import "../behavior/behavior";');
    write(
      "apps/ui/src/features/agent-management/behavior/behavior.ts",
      'import "../ui/elements/element";',
    );
    write(
      "apps/ui/src/features/agent-management/ui/elements/element.ts",
      'import "../blocks/block";',
    );
    write(
      "apps/ui/src/features/agent-management/ui/blocks/block.ts",
      'import "../sections/section";',
    );
    write(
      "apps/ui/src/features/agent-management/ui/sections/section.ts",
      "export const section = true;",
    );

    expect(policies([])).toEqual(
      expect.arrayContaining(["ui-feature-layout", "ui-feature-dependency-direction"]),
    );
    expect(
      policies([]).filter((policy) => policy === "ui-feature-dependency-direction"),
    ).toHaveLength(4);
  });

  it("accepts global browser behaviour under the apps/ui behavior root", () => {
    writeCatalogue([{ id: "agent-management" }]);
    write(
      "apps/ui/src/behavior/chunk-reload.ts",
      "export function registerChunkReloadListener(): void {}",
    );
    write(
      "apps/ui/src/screens/shell.tsx",
      'import { registerChunkReloadListener } from "../behavior/chunk-reload"; registerChunkReloadListener();',
    );

    expect(policies([])).not.toContain("ui-root-catch-all");
    expect(policies([])).not.toContain("ui-dependency-direction");
  });

  it("rejects the former app, platform, and testing roots", () => {
    writeCatalogue([{ id: "agent-management" }]);
    write("apps/ui/src/app/legacy-shell.tsx", "export const LegacyShell = true;");
    write("apps/ui/src/platform/legacy-navigation.ts", "export const legacyNavigation = true;");
    write("apps/ui/src/testing/legacy-fixture.ts", "export const legacyFixture = true;");

    expect(policies([]).filter((policy) => policy === "ui-root-catch-all")).toHaveLength(3);
  });

  it("rejects file-path imports that escape apps/ui source", () => {
    writeCatalogue([{ id: "trace-explorer" }]);
    write(
      "apps/ui/src/features/trace-explorer/prompt-cell.ts",
      'import "../../../../../packages/features/prompt/web/src/screens/prompt-studio";',
    );
    write(
      "packages/features/prompt/web/src/screens/prompt-studio/index.ts",
      "export const PromptStudio = true;",
    );

    expect(policies([])).toContain("ui-dependency-direction");
  });

  it("requires analyzable module specifiers while recognizing static template imports", () => {
    const promptWeb = webPackage("prompt", {
      "./surfaces/prompt-reference": "./src/surfaces/prompt-reference/index.ts",
    });
    writeCatalogue([
      {
        id: "trace-explorer",
        surfaces: ["@langwatch/prompt-web/surfaces/prompt-reference"],
      },
    ]);
    write(
      "apps/ui/src/features/trace-explorer/prompt-cell.ts",
      [
        "void import(`@langwatch/prompt-web/surfaces/prompt-reference`);",
        'const modulePath = "@langwatch/prompt-web";',
        "void import(modulePath);",
        "require(modulePath);",
      ].join("\n"),
    );
    write(
      "packages/features/prompt/web/src/surfaces/prompt-reference/index.ts",
      "export const PromptReference = true;",
    );

    expect(
      policies([promptWeb]).filter((policy) => policy === "ui-static-module-specifier"),
    ).toHaveLength(2);
  });

  it("rejects undeclared, root, deep, and incorrectly owned feature-web imports", () => {
    const promptWeb = webPackage("prompt", {
      ".": "./src/index.ts",
      "./screens/prompt-studio": "./src/screens/prompt-studio/index.ts",
      "./surfaces/prompt-reference": "./src/surfaces/prompt-reference/index.ts",
    });
    writeCatalogue([
      { id: "trace-explorer", surfaces: ["@langwatch/prompt-web/screens/prompt-studio"] },
    ]);
    write(
      "apps/ui/src/features/trace-explorer/route.tsx",
      [
        'import "@langwatch/prompt-web";',
        'import "@langwatch/prompt-web/src/internal/table";',
        'import "@langwatch/prompt-web/screens/prompt-studio";',
        'import "@langwatch/prompt-web/surfaces/prompt-reference";',
      ].join("\n"),
    );
    write("packages/features/prompt/web/src/index.ts", "export {};");
    write("packages/features/prompt/web/src/screens/prompt-studio/index.ts", "export {};");
    write("packages/features/prompt/web/src/surfaces/prompt-reference/index.ts", "export {};");

    expect(policies([promptWeb])).toEqual(
      expect.arrayContaining([
        "ui-web-public-entry",
        "ui-web-capability-declaration",
        "ui-screen-owner",
        "ui-surface-declaration",
      ]),
    );
  });

  it("rejects nested exports beneath an exact screen or surface entry", () => {
    const promptWeb = webPackage("prompt", {
      "./surfaces/prompt-reference/table": "./src/surfaces/prompt-reference/table.tsx",
    });
    writeCatalogue([
      {
        id: "trace-explorer",
        surfaces: ["@langwatch/prompt-web/surfaces/prompt-reference/table"],
      },
    ]);
    write(
      "apps/ui/src/features/trace-explorer/prompt-table.tsx",
      'import "@langwatch/prompt-web/surfaces/prompt-reference/table";',
    );
    write(
      "packages/features/prompt/web/src/surfaces/prompt-reference/table.tsx",
      "export const PromptTable = true;",
    );

    expect(policies([promptWeb])).toEqual(
      expect.arrayContaining(["ui-web-public-entry", "ui-web-capability-declaration"]),
    );
  });

  it("keeps a shareable surface out of hidden screens, state, transport, and other surfaces", () => {
    const promptWeb = webPackage("prompt", {
      "./surfaces/prompt-reference": "./src/surfaces/prompt-reference/index.ts",
      "./surfaces/prompt-version": "./src/surfaces/prompt-version/index.ts",
    });
    writeCatalogue([
      { id: "trace-explorer", surfaces: ["@langwatch/prompt-web/surfaces/prompt-reference"] },
    ]);
    write(
      "apps/ui/src/features/trace-explorer/route.ts",
      'import "@langwatch/prompt-web/surfaces/prompt-reference";',
    );
    write(
      "packages/features/prompt/web/src/surfaces/prompt-reference/index.ts",
      [
        'import "../../internal/prompt-table";',
        'import "../../tables/prompt-table";',
        'import "@langwatch/prompt-web/surfaces/prompt-version";',
      ].join("\n"),
    );
    write("packages/features/prompt/web/src/internal/prompt-table.ts", "export {};");
    write("packages/features/prompt/web/src/tables/prompt-table.ts", "export {};");
    write("packages/features/prompt/web/src/surfaces/prompt-version/index.ts", "export {};");

    expect(policies([promptWeb]).filter((policy) => policy === "ui-surface-closure")).toHaveLength(
      3,
    );
  });

  it("keeps owner-only screens browser-safe while allowing private presentation code", () => {
    const promptWeb = webPackage("prompt", {
      "./screens/prompt-studio": "./src/screens/prompt-studio/index.ts",
    });
    writeCatalogue([
      {
        id: "prompt-studio",
        screens: ["@langwatch/prompt-web/screens/prompt-studio"],
      },
    ]);
    write(
      "apps/ui/src/features/prompt-studio/route.ts",
      'import "@langwatch/prompt-web/screens/prompt-studio";',
    );
    write(
      "packages/features/prompt/web/src/screens/prompt-studio/index.ts",
      [
        'import "./prompt-table";',
        'import "@langwatch/prompt-server";',
        'import "node:fs";',
        'import "react-router";',
        'import "~/screens/hidden";',
        "fetch('/api/prompts');",
        "const mode = process.env.NODE_ENV;",
      ].join("\n"),
    );
    write(
      "packages/features/prompt/web/src/screens/prompt-studio/prompt-table.ts",
      "export const PromptTable = true;",
    );

    expect(policies([promptWeb]).filter((policy) => policy === "ui-screen-closure")).toHaveLength(
      6,
    );
  });

  it("keeps a shareable surface out of every external implementation boundary", () => {
    const promptWeb = webPackage("prompt", {
      "./surfaces/prompt-reference": "./src/surfaces/prompt-reference/index.ts",
      "./testing": "./src/__tests__/prompt-reference.fixture.ts",
    });
    writeCatalogue([
      { id: "trace-explorer", surfaces: ["@langwatch/prompt-web/surfaces/prompt-reference"] },
    ]);
    write(
      "apps/ui/src/features/trace-explorer/route.ts",
      'import "@langwatch/prompt-web/surfaces/prompt-reference";',
    );
    write(
      "packages/features/prompt/web/src/surfaces/prompt-reference/index.ts",
      [
        'import "@langwatch/trace-web/surfaces/trace-reference";',
        'import "@langwatch/prompt-server";',
        'import "@langwatch/platform-api";',
        'import "@langwatch/prisma-client";',
        'import "@langwatch/observability";',
        'import type { Trace } from "@langwatch/trace-contract";',
        'import { Button } from "@langwatch/design-system";',
        'import "node:fs";',
        'import "~/utils/env";',
        'import "@app/prompts";',
        'import "../../../../../../../platform/app/src/prompts";',
      ].join("\n"),
    );
    write("packages/features/prompt/web/src/__tests__/prompt-reference.fixture.ts", "export {};");
    write("platform/app/src/prompts.ts", "export {};");

    expect(policies([promptWeb]).filter((policy) => policy === "ui-surface-closure")).toHaveLength(
      10,
    );
    expect(policies([promptWeb])).not.toContain("ui-web-public-entry");
  });

  it("keeps browser UI out of server, Prisma, AppRouter, environment, and legacy application imports", () => {
    writeCatalogue([{ id: "prompt-studio" }]);
    write(
      "apps/ui/src/features/prompt-studio/route.ts",
      [
        'import "@langwatch/prompt-server";',
        'import "@langwatch/prisma-client";',
        'import "~/server/trpc";',
        'import "@app/prompts";',
        'import "~/utils/env";',
        'import "node:fs";',
        'import "react-router";',
        "type Route = AppRouter;",
        "const config = process.env.PUBLIC_VALUE;",
        "fetch('/api/prompts');",
        "localStorage.getItem('project');",
      ].join("\n"),
    );

    expect(policies([]).filter((policy) => policy === "ui-backend-access")).toHaveLength(8);
    expect(policies([]).filter((policy) => policy === "ui-browser-capability")).toHaveLength(3);
  });

  it("accepts the two-scope private web hierarchy and recursive browser-safe screen closure", () => {
    const agentWeb = webPackage("agent", {
      "./screens/agent-management": "./src/screens/agent-management/index.ts",
      "./surfaces/browser-port": "./src/surfaces/browser-port/index.ts",
    });
    writeCatalogue([
      {
        id: "agent-management",
        screens: ["@langwatch/agent-web/screens/agent-management"],
        surfaces: ["@langwatch/agent-web/surfaces/browser-port"],
      },
    ]);
    writeWebFeature("agent", "management", ["tunnel"]);
    writeWebFeature("agent", "tunnel");
    write(
      "packages/features/agent/web/src/features/tunnel/index.ts",
      'export { TunnelBadge } from "./ui/elements/tunnel-badge";',
    );
    write(
      "packages/features/agent/web/src/features/tunnel/ui/elements/tunnel-badge.tsx",
      "export const TunnelBadge = true;",
    );
    write(
      "packages/features/agent/web/src/features/management/ui/blocks/agent-card.tsx",
      "export const AgentCard = true;",
    );
    write(
      "packages/features/agent/web/src/features/management/ui/sections/agent-management.tsx",
      [
        'import { AgentLabel } from "../../../../model/agent-label";',
        'import { agentBehavior } from "../../../../behavior/agent-behavior";',
        'import { PackageElement } from "../../../../ui/elements/package-element";',
        'import { TunnelBadge } from "../../../tunnel";',
        'import { AgentCard } from "../blocks/agent-card";',
        "export const AgentManagement = [AgentLabel, agentBehavior, PackageElement, TunnelBadge, AgentCard];",
      ].join("\n"),
    );
    write(
      "packages/features/agent/web/src/model/agent-label.ts",
      'export const AgentLabel = "Agent";',
    );
    write(
      "packages/features/agent/web/src/behavior/agent-behavior.ts",
      'import { AgentLabel } from "../model/agent-label"; export const agentBehavior = AgentLabel;',
    );
    write(
      "packages/features/agent/web/src/ui/elements/package-element.tsx",
      'import { AgentLabel } from "../../model/agent-label"; export const PackageElement = AgentLabel;',
    );
    write(
      "packages/features/agent/web/src/screens/agent-management/index.ts",
      'export { AgentManagement } from "../../features/management/ui/sections/agent-management";',
    );
    write(
      "packages/features/agent/web/src/surfaces/browser-port/index.ts",
      "export abstract class AgentBrowserPort {}",
    );
    write(
      "apps/ui/src/features/agent-management/index.ts",
      'import "@langwatch/agent-web/screens/agent-management"; import "@langwatch/agent-web/surfaces/browser-port";',
    );

    expect(lint([agentWeb])).toEqual([]);
  });

  it("rejects flat root files, generic components, upward layers, and deep feature imports", () => {
    const agentWeb = webPackage("agent", {
      "./screens/agent-management": "./src/screens/agent-management/index.ts",
    });
    writeCatalogue([
      { id: "agent-management", screens: ["@langwatch/agent-web/screens/agent-management"] },
    ]);
    writeWebFeature("agent", "management", ["tunnel"]);
    writeWebFeature("agent", "tunnel");
    write("packages/features/agent/web/src/agent-card.tsx", "export const AgentCard = true;");
    write("packages/features/agent/web/src/components/card.tsx", "export const Card = true;");
    write(
      "packages/features/agent/web/src/features/management/model/agent.ts",
      'import "../ui/sections/agent-management";',
    );
    write(
      "packages/features/agent/web/src/features/management/ui/sections/agent-management.tsx",
      'import "@/features/tunnel/ui/elements/tunnel-badge";',
    );
    write(
      "packages/features/agent/web/src/features/tunnel/ui/elements/tunnel-badge.tsx",
      "export const TunnelBadge = true;",
    );
    write(
      "packages/features/agent/web/src/screens/agent-management/index.ts",
      "export const AgentManagement = true;",
    );

    expect(policies([agentWeb])).toEqual(
      expect.arrayContaining([
        "ui-web-root-flat",
        "ui-web-root-components",
        "ui-web-layer-direction",
        "ui-web-feature-deep-import",
      ]),
    );
  });

  it("requires declared acyclic feature dependencies through a feature entry point", () => {
    const agentWeb = webPackage("agent", {
      "./screens/agent-management": "./src/screens/agent-management/index.ts",
    });
    writeCatalogue([
      { id: "agent-management", screens: ["@langwatch/agent-web/screens/agent-management"] },
    ]);
    writeWebFeature("agent", "management");
    writeWebFeature("agent", "tunnel", ["management"]);
    write(
      "packages/features/agent/web/src/features/management/ui/sections/agent-management.tsx",
      'import "../../../tunnel";',
    );
    write(
      "packages/features/agent/web/src/features/tunnel/index.ts",
      'export { Tunnel } from "./ui/elements/tunnel";',
    );
    write(
      "packages/features/agent/web/src/features/tunnel/ui/elements/tunnel.tsx",
      'import "../../../management"; export const Tunnel = true;',
    );
    write(
      "packages/features/agent/web/src/features/management/index.ts",
      'import "../tunnel"; import "../tunnel/ui/elements/tunnel"; export const Management = true;',
    );
    write(
      "packages/features/agent/web/src/screens/agent-management/index.ts",
      "export const AgentManagement = true;",
    );

    expect(policies([agentWeb])).toEqual(
      expect.arrayContaining([
        "ui-web-feature-dependency-declaration",
        "ui-web-feature-cycle",
        "ui-web-feature-entry-leakage",
      ]),
    );
  });

  it("keeps screens and surfaces from leaking into each other's private composition", () => {
    const agentWeb = webPackage("agent", {
      "./screens/agent-management": "./src/screens/agent-management/index.ts",
      "./surfaces/browser-port": "./src/surfaces/browser-port/index.ts",
    });
    writeCatalogue([
      {
        id: "agent-management",
        screens: ["@langwatch/agent-web/screens/agent-management"],
        surfaces: ["@langwatch/agent-web/surfaces/browser-port"],
      },
    ]);
    write(
      "packages/features/agent/web/src/screens/agent-management/index.ts",
      'import "../../surfaces/browser-port"; import "../other-screen"; export const AgentManagement = true;',
    );
    write(
      "packages/features/agent/web/src/surfaces/browser-port/index.ts",
      'import "../../features/management/ui/sections/agent-management"; export abstract class AgentBrowserPort {}',
    );
    writeWebFeature("agent", "management");
    write(
      "packages/features/agent/web/src/features/management/ui/sections/agent-management.tsx",
      'import "../../../../screens/other-screen"; export const AgentManagement = true;',
    );
    write(
      "packages/features/agent/web/src/screens/other-screen/index.ts",
      "export const Other = true;",
    );

    expect(policies([agentWeb])).toEqual(
      expect.arrayContaining([
        "ui-web-screen-leakage",
        "ui-web-surface-leakage",
        "ui-web-public-boundary-leakage",
      ]),
    );
  });

  it("reports only the actual members of a declared feature dependency cycle", () => {
    const agentWeb = webPackage("agent", {
      "./screens/agent-management": "./src/screens/agent-management/index.ts",
    });
    writeCatalogue([
      { id: "agent-management", screens: ["@langwatch/agent-web/screens/agent-management"] },
    ]);
    writeWebFeature("agent", "alpha", ["beta", "gamma"]);
    writeWebFeature("agent", "beta", ["gamma"]);
    writeWebFeature("agent", "gamma", ["beta"]);
    write(
      "packages/features/agent/web/src/screens/agent-management/index.ts",
      "export const AgentManagement = true;",
    );

    const cycleViolations = lint([agentWeb]).filter(
      (violation) => violation.policy === "ui-web-feature-cycle",
    );
    expect(cycleViolations).toHaveLength(1);
    expect(cycleViolations[0]?.message).toContain('"beta", "gamma"');
    expect(cycleViolations[0]?.message).not.toContain('"alpha"');
  });

  it("checks browser capability safety through screen-to-feature recursion", () => {
    const agentWeb = webPackage("agent", {
      "./screens/agent-management": "./src/screens/agent-management/index.ts",
    });
    writeCatalogue([
      { id: "agent-management", screens: ["@langwatch/agent-web/screens/agent-management"] },
    ]);
    writeWebFeature("agent", "management");
    write(
      "packages/features/agent/web/src/screens/agent-management/index.ts",
      'export { AgentManagement } from "../../features/management/ui/sections/agent-management";',
    );
    write(
      "packages/features/agent/web/src/features/management/ui/sections/agent-management.tsx",
      "fetch('/api/agents'); export const AgentManagement = true;",
    );

    expect(policies([agentWeb])).toContain("ui-screen-closure");
  });
});
