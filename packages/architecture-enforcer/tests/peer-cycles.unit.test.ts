/** Spec: specs/peer-cycles.feature. Record: dev/docs/ARCHITECTURE.md §5, peer cycles. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  keptPeerCycleEdges,
  lintPeerCycles,
  peerCycleEdges,
  peerCycleFindings,
  type PeerCycleException,
} from "../src/policies/boundaries/peer-cycles.ts";
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

function exception(overrides: Partial<PeerCycleException> = {}): PeerCycleException {
  return {
    between: ["a", "b"],
    owner: "a",
    reason: "a asks b for a guard",
    ruling: "a ruling",
    ...overrides,
  };
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

  describe("given a named exception for a two-module cycle", () => {
    /** @scenario "A named exception keeps exactly its two-module cycle" */
    it("reports nothing and keeps both edges", () => {
      const workspace = fixture(["a", "b"]);
      workspace.write("modules/a/process/src/app/a.app.ts", app({ feature: "a", peers: ["b"] }));
      workspace.write("modules/b/process/src/app/b.app.ts", app({ feature: "b", peers: ["a"] }));
      const exceptions = [exception()];

      expect(peerCycleFindings({ packages: workspace.packages, exceptions })).toEqual([]);
      expect(
        keptPeerCycleEdges({ packages: workspace.packages, exceptions }).map((edge) => [
          edge.from,
          edge.to,
        ]),
      ).toEqual([
        ["a", "b"],
        ["b", "a"],
      ]);
    });
  });

  describe("given a named exception whose pair also sits on a longer loop", () => {
    /** @scenario "A named exception does not hide a longer loop through its pair" */
    it("reports the longer loop's edges with their way back", () => {
      const workspace = fixture(["a", "b", "c"]);
      workspace.write("modules/a/process/src/app/a.app.ts", app({ feature: "a", peers: ["b"] }));
      workspace.write(
        "modules/b/process/src/app/b.app.ts",
        app({ feature: "b", peers: ["a", "c"] }),
      );
      workspace.write("modules/c/process/src/app/c.app.ts", app({ feature: "c", peers: ["a"] }));
      const exceptions = [exception()];

      expect(
        peerCycleEdges({ packages: workspace.packages, exceptions }).map((edge) => [
          edge.from,
          edge.to,
          edge.back.join(" -> "),
        ]),
      ).toEqual([
        ["a", "b", "b -> c -> a"],
        ["b", "c", "c -> a -> b"],
        ["c", "a", "a -> b -> c"],
      ]);
      expect(
        keptPeerCycleEdges({ packages: workspace.packages, exceptions }).map((edge) => edge.from),
      ).toEqual(["b"]);
    });
  });

  describe("given a named exception whose cycle is gone", () => {
    /** @scenario "A named exception whose modules no longer name each other is reported for deletion" */
    it("reports the exception", () => {
      const workspace = fixture(["a", "b"]);
      workspace.write("modules/a/process/src/app/a.app.ts", app({ feature: "a", peers: ["b"] }));

      expect(
        peerCycleFindings({ packages: workspace.packages, exceptions: [exception()] }).map(
          (finding) => finding.message,
        ),
      ).toEqual(["The named exception a <-> b no longer names a two-module cycle; delete it."]);
    });
  });

  describe("given a named exception missing its owner, reason or ruling", () => {
    /** @scenario "A named exception without an owner, a reason or a ruling is refused" */
    it.each([
      [{ owner: "c" }, "has no owner among its two modules"],
      [{ reason: " " }, "states no reason"],
      [{ ruling: "" }, "cites no ruling"],
    ])("refuses %o", (overrides, problem) => {
      const workspace = fixture(["a", "b"]);
      workspace.write("modules/a/process/src/app/a.app.ts", app({ feature: "a", peers: ["b"] }));
      workspace.write("modules/b/process/src/app/b.app.ts", app({ feature: "b", peers: ["a"] }));

      expect(
        peerCycleFindings({
          packages: workspace.packages,
          exceptions: [exception(overrides)],
        }).map((finding) => finding.message),
      ).toEqual([`The named exception a <-> b ${problem}.`]);
    });
  });
});
