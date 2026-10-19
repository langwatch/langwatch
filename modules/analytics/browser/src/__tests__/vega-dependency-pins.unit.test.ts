/**
 * @vitest-environment node
 * The Vega packages the dashboard widget draws with are direct dependencies,
 * pinned to one exact version each, and each one's peer range admits the others.
 * @see specs/lwql/workbench.feature
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workspaceFile = join(packageRoot, "..", "..", "..", "pnpm-workspace.yaml");
const VEGA_PACKAGES = ["vega", "vega-lite", "vega-embed"] as const;
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

const manifestSchema = z.object({
  version: z.string(),
  dependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
});

function readManifest(path: string): z.infer<typeof manifestSchema> {
  return manifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

function catalogVersion(name: string): string | undefined {
  const line = readFileSync(workspaceFile, "utf8")
    .split("\n")
    .find((candidate) => candidate.trim().startsWith(`${name}:`));
  return line?.split(":")[1]?.trim();
}

function declaredVersion(name: string): string | undefined {
  const declared = readManifest(join(packageRoot, "package.json")).dependencies?.[name];
  return declared === "catalog:" ? catalogVersion(name) : declared;
}

/** Whether a peer range this repository uses ("*" or a caret range) admits a version. */
function admits({ range, version }: { range: string; version: string }): boolean {
  if (range === "*") return true;
  const [rangeMajor] = range.replace(/^\^/, "").split(".");
  const [versionMajor] = version.split(".");
  return range.startsWith("^") && rangeMajor === versionMajor;
}

describe("the Vega dependency set", () => {
  describe("given the application's dependency manifest", () => {
    describe("when the Vega packages are inspected", () => {
      /** @scenario The Vega dependency set is pinned and compatible */
      it("declares vega, vega-lite and vega-embed directly at exact versions", () => {
        for (const name of VEGA_PACKAGES) {
          expect(declaredVersion(name), name).toMatch(EXACT_VERSION);
        }
      });

      /** @scenario The Vega dependency set is pinned and compatible */
      it("installs those versions, each admitted by the others' peer ranges", () => {
        const installed = new Map<string, z.infer<typeof manifestSchema>>(
          VEGA_PACKAGES.map((name) => [
            name,
            readManifest(join(packageRoot, "node_modules", name, "package.json")),
          ]),
        );

        for (const [name, manifest] of installed) {
          expect(manifest.version, name).toBe(declaredVersion(name));
          for (const [peer, range] of Object.entries(manifest.peerDependencies ?? {})) {
            const peerVersion = installed.get(peer)?.version;
            if (peerVersion === undefined) continue;
            expect(admits({ range, version: peerVersion }), `${name} -> ${peer} ${range}`).toBe(
              true,
            );
          }
        }
      });
    });
  });
});
