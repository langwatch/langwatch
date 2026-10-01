/** Spec: specs/peer-cycles.feature. Record: dev/docs/ARCHITECTURE.md §5, peer cycles. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { lintPeerCycles, peerCycleEdges } from "../src/policies/boundaries/peer-cycles.ts";
import type { ClassifiedPackage } from "../src/types.ts";
import { snapshotOf } from "./workspace.ts";

const KINDS: readonly ("contract" | "process")[] = ["contract", "process"];
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(features: readonly string[]) {
  const root = mkdtempSync(join(tmpdir(), "peer-cycles-"));
  roots.push(root);
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  const packages = features.flatMap((feature): ClassifiedPackage[] =>
    KINDS.map((kind) => ({
      name: `@langwatch/${feature}-${kind}`,
      root: join(root, "modules", feature, kind),
      manifestPath: join(root, "modules", feature, kind, "package.json"),
      manifest: {},
      kind,
      feature,
      enterprise: false,
    })),
  );

  return { root, write, edges: () => peerCycleEdges({ packages }), packages };
}

function app({ feature, peers }: { feature: string; peers: readonly string[] }): string {
  const token = (peer: string) => `${peer.toUpperCase()}Api`;
  const imports = peers
    .map((peer) => `import { ${token(peer)} } from "@langwatch/${peer}-contract";`)
    .join("\n");
  const entries = peers.map((peer) => `${peer}: ${token(peer)},`).join(" ");

  return `${imports}\nexport class ${feature.toUpperCase()}App {\n  static readonly dependencies = { ${entries} };\n}\n`;
}

describe("peer-cycles", () => {
  describe("given two modules depending on each other's Api", () => {
    /** @scenario "A peer dependency whose peer reaches back is a cycle edge" */
    it("reports both edges with the way back", () => {
      const workspace = fixture(["a", "b"]);
      workspace.write("modules/a/process/src/app/a.app.ts", app({ feature: "a", peers: ["b"] }));
      workspace.write("modules/b/process/src/app/b.app.ts", app({ feature: "b", peers: ["a"] }));

      expect(workspace.edges().map((edge) => [edge.from, edge.to, edge.back.join(" -> ")])).toEqual(
        [
          ["a", "b", "b -> a"],
          ["b", "a", "a -> b"],
        ],
      );

      const [violation] = lintPeerCycles(
        snapshotOf({ root: workspace.root, packages: workspace.packages, catalogue: [] }),
      );
      expect(violation?.message).toBe("a depends on b's Api, and b reaches back: b -> a.");
      expect(violation?.line).toBe(3);
    });
  });

  describe("given a dependency with no way back", () => {
    /** @scenario "A peer dependency the peer cannot reach back through is not reported" */
    it("reports nothing", () => {
      const workspace = fixture(["a", "b", "c"]);
      workspace.write("modules/a/process/src/app/a.app.ts", app({ feature: "a", peers: ["b"] }));
      workspace.write("modules/b/process/src/app/b.app.ts", app({ feature: "b", peers: ["c"] }));

      expect(workspace.edges()).toEqual([]);
    });
  });

  describe("given a dependency map held in a sibling file's constant", () => {
    /** @scenario "A dependency map held in a constant of another file is followed" */
    it("reads the peers that constant names", () => {
      const workspace = fixture(["a", "b"]);
      workspace.write(
        "modules/a/process/src/app/a.members.ts",
        `import { BApi } from "@langwatch/b-contract";\nexport const aDependencies = { b: BApi };\n`,
      );
      workspace.write(
        "modules/a/process/src/app/a.app.ts",
        `import { aDependencies } from "./a.members.ts";\nexport class AApp {\n  static readonly dependencies = aDependencies;\n}\n`,
      );
      workspace.write("modules/b/process/src/app/b.app.ts", app({ feature: "b", peers: ["a"] }));

      expect(workspace.edges().map((edge) => [edge.from, edge.to])).toEqual([
        ["a", "b"],
        ["b", "a"],
      ]);
    });
  });
});
