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
      "apps/ui/src/features/prompt-studio/route.tsx",
      'import { PromptStudio } from "@langwatch/prompt-web/screens/prompt-studio"; export { PromptStudio };',
    );
    write(
      "apps/ui/src/features/trace-explorer/prompt-cell.tsx",
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
    expect(policies([]).filter((policy) => policy === "ui-root-catch-all")).toHaveLength(3);
  });

  it("enforces app, platform, and frontend feature dependency direction", () => {
    writeCatalogue([{ id: "prompt-studio" }, { id: "trace-explorer" }]);
    write("apps/ui/src/platform/api/client.ts", 'import "../../features/prompt-studio/route";');
    write(
      "apps/ui/src/features/prompt-studio/route.ts",
      'import "../../app/router"; import "../trace-explorer/route";',
    );
    write("apps/ui/src/features/trace-explorer/route.ts", 'import "../prompt-studio/route";');
    write("apps/ui/src/app/router.ts", "export const router = true;");

    expect(policies([])).toEqual(
      expect.arrayContaining([
        "ui-dependency-direction",
        "ui-feature-implementation-import",
        "ui-feature-cycle",
      ]),
    );
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
});
