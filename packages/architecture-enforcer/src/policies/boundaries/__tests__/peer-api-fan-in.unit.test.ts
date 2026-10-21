/** Spec: specs/module-ownership.feature. Record: dev/docs/ARCHITECTURE.md §17, rule 13d. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ClassifiedPackage, FeatureCatalogueEntry } from "../../../types.ts";
import { forgetFileListings } from "../../../workspace/layout.ts";
import { collectPeerApiFanIn, lintPeerApiFanIn } from "../peer-api-fan-in.ts";

const roots: string[] = [];
const A_API = `export interface AApi {\n  one(): void;\n  two(): void;\n  three(): void;\n  four(): void;\n}\n`;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  forgetFileListings();
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "peer-api-fan-in-"));
  roots.push(root);
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  const modules = ["a", "b"];
  const catalogue = modules.map((id): FeatureCatalogueEntry => ({
    id,
    root: `modules/${id}`,
    classification: "core",
    subjects: [id],
  }));
  const packages = modules.map((feature): ClassifiedPackage => ({
    name: `@langwatch/${feature}-contract`,
    root: join(root, "modules", feature, "contract"),
    manifestPath: join(root, "modules", feature, "contract", "package.json"),
    manifest: {},
    kind: "contract",
    feature,
    enterprise: false,
  }));
  write("modules/a/contract/src/a.api.ts", A_API);
  const found = () =>
    collectPeerApiFanIn({ root, catalogue, packages }).map((item) => [item.api, item.operations]);

  return { root, write, catalogue, packages, found };
}

const IMPORT = 'import type { AApi } from "@langwatch/a-contract";\n';

describe("peer-api-fan-in", () => {
  describe("given b's service picks four operations of a's Api", () => {
    describe("when the services are read", () => {
      /** @scenario "A service picking four operations of one peer Api is reported" */
      it("reports the four operations", () => {
        const workspace = fixture();
        workspace.write(
          "modules/b/process/src/services/b.service.ts",
          `${IMPORT}type Peer = Pick<AApi, "one" | "two" | "three" | "four">;\n`,
        );

        expect(workspace.found()).toEqual([["AApi", ["four", "one", "three", "two"]]]);
      });
    });
  });

  describe("given b's service holds a field typed with a's Api", () => {
    describe("when it calls four of its operations", () => {
      /** @scenario "Calls on an injected peer Api field count as operations" */
      it("reports the four called operations", () => {
        const workspace = fixture();
        workspace.write(
          "modules/b/process/src/services/b.service.ts",
          `${IMPORT}export class BService {\n  constructor(private readonly peer: AApi) {}\n  run() {\n    this.peer.one(); this.peer.two(); this.peer.three(); this.peer.four();\n  }\n}\n`,
        );

        expect(workspace.found()).toEqual([["AApi", ["four", "one", "three", "two"]]]);
      });
    });
  });

  describe("given three picked operations and a local array of the field's name", () => {
    describe("when the services are read", () => {
      /** @scenario "Three operations, or calls that are not the Api's own, are not reported" */
      it("reports nothing", () => {
        const workspace = fixture();
        workspace.write(
          "modules/b/process/src/services/b.service.ts",
          `${IMPORT}export class BService {\n  constructor(private readonly peer: Pick<AApi, "one" | "two" | "three">) {}\n  run(peer: number[]) {\n    return peer.map((item) => item);\n  }\n}\n`,
        );

        expect(workspace.found()).toEqual([]);
      });
    });
  });

  describe("given a's own service picks four operations of AApi", () => {
    describe("when the services are read", () => {
      /** @scenario "A module's own Api is not a peer" */
      it("reports nothing", () => {
        const workspace = fixture();
        workspace.write(
          "modules/a/process/src/services/a.service.ts",
          `${IMPORT}type Own = Pick<AApi, "one" | "two" | "three" | "four">;\n`,
        );

        expect(workspace.found()).toEqual([]);
      });
    });
  });

  describe("given a composition root picks four operations of AApi", () => {
    describe("when the services are read", () => {
      /** @scenario "A composition root is not read" */
      it("reports nothing", () => {
        const workspace = fixture();
        workspace.write(
          "modules/b/process/src/app/b.app.ts",
          `${IMPORT}type Peer = Pick<AApi, "one" | "two" | "three" | "four">;\n`,
        );

        expect(workspace.found()).toEqual([]);
      });
    });
  });

  describe("given a service taking four operations of a peer's Api", () => {
    describe("when the finding is linted", () => {
      /** @scenario "A peer-api-fan-in finding says what to do instead" */
      it("tells it to ask the peer for one operation or move the service", () => {
        const workspace = fixture();
        workspace.write(
          "modules/b/process/src/services/b.service.ts",
          `${IMPORT}type Peer = Pick<AApi, "one" | "two" | "three" | "four">;\n`,
        );
        const [finding] = lintPeerApiFanIn({
          root: workspace.root,
          catalogue: workspace.catalogue,
          packages: workspace.packages,
        });

        expect(finding?.message).toContain("b takes 4 operations of a's AApi");
        expect(finding?.allowed).toContain("Ask the peer for one operation that does the work");
      });
    });
  });
});
