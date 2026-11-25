import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lintWorkspace } from "../src/index.ts";
import { writePolicyAnchors } from "./workspace.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-client-role-"));
  writePolicyAnchors(root);
  write(
    "modules/catalogue.json",
    JSON.stringify({
      version: 0,
      features: ["agent", "workflow"].map((id) => ({
        id,
        root: `modules/${id}`,
        classification: "core",
        subjects: [id],
      })),
    }),
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function modulePackage({
  feature,
  role,
  dependencies = {},
}: {
  feature: string;
  role: "contract" | "process" | "browser" | "client";
  dependencies?: Record<string, string>;
}): void {
  const name = `@langwatch/${feature}-${role}`;
  write(
    `modules/${feature}/${role}/package.json`,
    JSON.stringify({ name, exports: { ".": "./src/index.ts" }, dependencies }),
  );
  write(`modules/${feature}/${role}/src/index.ts`, "export const value = true;\n");
}

const BOUNDARY_POLICIES = new Set(["package-role", "cross-feature", "feature-layout"]);

/** The refused specifiers of one boundary policy, for manifests under `pathPart`. */
function refused({ policy, pathPart }: { policy: string; pathPart: string }): string[] {
  return lintWorkspace({ root, declarations: false })
    .filter((violation) => violation.policy === policy && violation.file.includes(pathPart))
    .flatMap(({ specifier }) => (specifier === undefined ? [] : [specifier]))
    .toSorted((a, b) => a.localeCompare(b));
}

describe("given the client package role", () => {
  describe("when a client takes its contract, the wire, browser-host and React", () => {
    /** @scenario "A client may depend on its own contract, the wire, browser-host and React" */
    it("reports no boundary violation, and a peer's browser may depend on it", () => {
      modulePackage({ feature: "agent", role: "contract" });
      modulePackage({
        feature: "agent",
        role: "client",
        dependencies: {
          "@langwatch/agent-contract": "workspace:*",
          "@langwatch/api": "workspace:*",
          "@langwatch/browser-host": "workspace:*",
          react: "^19.2.7",
        },
      });
      modulePackage({
        feature: "workflow",
        role: "browser",
        dependencies: { "@langwatch/agent-client": "workspace:*" },
      });

      const found = lintWorkspace({ root, declarations: false }).filter(
        ({ policy, file }) => BOUNDARY_POLICIES.has(policy) && file.includes("/client/"),
      );
      const fromBrowser = lintWorkspace({ root, declarations: false }).filter(
        ({ policy, specifier }) =>
          BOUNDARY_POLICIES.has(policy) && specifier === "@langwatch/agent-client",
      );
      expect(found).toEqual([]);
      expect(fromBrowser).toEqual([]);
    });
  });

  describe("when a client depends on a process, a browser, a peer's contract or a store", () => {
    /** @scenario "A client may not depend on a process, browser or store package" */
    it("reports each dependency as package-role", () => {
      modulePackage({ feature: "agent", role: "contract" });
      modulePackage({ feature: "agent", role: "process" });
      modulePackage({ feature: "workflow", role: "contract" });
      modulePackage({ feature: "workflow", role: "browser" });
      modulePackage({
        feature: "agent",
        role: "client",
        dependencies: {
          "@langwatch/agent-contract": "workspace:*",
          "@langwatch/agent-process": "workspace:*",
          "@langwatch/workflow-browser": "workspace:*",
          "@langwatch/workflow-contract": "workspace:*",
          "@langwatch/prisma-client": "workspace:*",
          "@langwatch/design-system": "workspace:*",
          "react-dom": "^19.2.7",
        },
      });

      expect(refused({ policy: "package-role", pathPart: "agent/client" })).toEqual([
        "@langwatch/agent-process",
        "@langwatch/design-system",
        "@langwatch/prisma-client",
        "@langwatch/workflow-browser",
        "@langwatch/workflow-contract",
        "react-dom",
      ]);
    });
  });

  describe("when a process, a contract, another client or a server app depends on a client", () => {
    /** @scenario "Only browser packages and the browser application may depend on a client" */
    it("reports each edge as package-role and lets apps/ui through", () => {
      modulePackage({ feature: "agent", role: "client" });
      const onClient = { "@langwatch/agent-client": "workspace:*" };
      modulePackage({ feature: "workflow", role: "process", dependencies: onClient });
      modulePackage({ feature: "workflow", role: "contract", dependencies: onClient });
      modulePackage({ feature: "workflow", role: "client", dependencies: onClient });
      write(
        "apps/api/package.json",
        JSON.stringify({ name: "@langwatch/platform-api", dependencies: onClient }),
      );
      write(
        "apps/ui/package.json",
        JSON.stringify({ name: "@langwatch/ui", dependencies: onClient }),
      );

      const edges = lintWorkspace({ root, declarations: false })
        .filter(
          ({ policy, specifier }) =>
            policy === "package-role" && specifier === "@langwatch/agent-client",
        )
        .map(({ file }) => file)
        .toSorted((a, b) => a.localeCompare(b));
      expect(edges).toEqual([
        "apps/api/package.json",
        "modules/workflow/client/package.json",
        "modules/workflow/contract/package.json",
        "modules/workflow/process/package.json",
      ]);
    });
  });

  describe("when a server application imports a client in source", () => {
    /** @scenario "A server application importing a client in source is refused" */
    it("reports application-boundary at the import", () => {
      modulePackage({ feature: "agent", role: "client" });
      write("apps/api/package.json", JSON.stringify({ name: "@langwatch/platform-api" }));
      write(
        "apps/api/src/main.ts",
        'import { value } from "@langwatch/agent-client";\nvoid value;\n',
      );
      write("apps/ui/package.json", JSON.stringify({ name: "@langwatch/ui" }));
      write(
        "apps/ui/src/main.tsx",
        'import { value } from "@langwatch/agent-client";\nvoid value;\n',
      );

      const found = lintWorkspace({ root, declarations: false }).filter(
        ({ policy, specifier }) =>
          policy === "application-boundary" && specifier === "@langwatch/agent-client",
      );
      expect(found.map(({ file }) => file)).toEqual(["apps/api/src/main.ts"]);
    });
  });
});
