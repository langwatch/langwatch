import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateModuleLists } from "../../../dev/scripts/generate-modules.mjs";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../..");
const scratch: string[] = [];

afterAll(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true });
});

/** One module on disk, as the generator reads it: a catalogue and an App. */
function moduleTree(app: string): string {
  const root = mkdtempSync(join(tmpdir(), "installed-modules-"));
  scratch.push(root);
  const server = join(root, "modules/annotation/server/src/app");
  mkdirSync(server, { recursive: true });
  mkdirSync(join(root, "modules"), { recursive: true });
  writeFileSync(
    join(root, "modules/catalogue.json"),
    JSON.stringify({
      version: 0,
      features: [{ id: "annotation", root: "modules/annotation", tier: "core" }],
    }),
  );
  writeFileSync(join(root, "modules/annotation/server/package.json"), '{"name":"x"}');
  writeFileSync(join(server, "annotation.app.ts"), app);
  return root;
}

/** What the generator wrote for the one module in that tree. */
function membersIn(root: string): string {
  const generated = generateModuleLists({ root, tier: "core" });
  return generated["modules/server-module-members.generated.ts"] ?? "";
}

describe("given the checked-in module lists", () => {
  describe("when the generator runs again over the catalogue", () => {
    it("writes what the open-source tier already carries", () => {
      const generated = generateModuleLists({ root: REPOSITORY_ROOT, tier: "core" });

      for (const [path, source] of Object.entries(generated)) {
        const checkedIn = readFileSync(resolve(REPOSITORY_ROOT, path), "utf8");
        expect(`${path}:\n${checkedIn}`).toBe(`${path}:\n${source}`);
      }
    });

    /** @scenario "The module list is generated from the catalogue" */
    it("keeps every enterprise module out of the open-source lists", () => {
      const catalogue = JSON.parse(
        readFileSync(resolve(REPOSITORY_ROOT, "modules/catalogue.json"), "utf8"),
      ) as { features: { id: string; tier: string }[] };
      const generated = generateModuleLists({ root: REPOSITORY_ROOT, tier: "core" });
      const source = generated["modules/server-modules.generated.ts"] ?? "";

      const enterprise = catalogue.features.filter((entry) => entry.tier === "enterprise");

      expect(enterprise.length).toBeGreaterThan(0);
      expect(enterprise.filter((entry) => source.includes(`/${entry.id}-server"`))).toEqual([]);
    });

    it("reads each module's members off the `reads` its App declared", () => {
      const root = moduleTree(`
        export class AnnotationApp {
          static readonly contract = AnnotationApi;
          static readonly reads = reads("clock", "logger");
        }
      `);

      expect(membersIn(root)).toContain('annotation: ["clock", "logger"],');
    });

    it("records an empty list for a module whose App names no member", () => {
      const root = moduleTree(`
        export class AnnotationApp {
          static readonly contract = AnnotationApi;
        }
      `);

      expect(membersIn(root)).toContain("annotation: [],");
    });

    it("names every enterprise module the enterprise tier installs", () => {
      const enterprise = generateModuleLists({ root: REPOSITORY_ROOT, tier: "enterprise" });
      const core = generateModuleLists({ root: REPOSITORY_ROOT, tier: "core" });

      const added = (enterprise["modules/server-modules.generated.ts"] ?? "")
        .split("\n")
        .filter((line) => line.startsWith("import "))
        .filter((line) => !(core["modules/server-modules.generated.ts"] ?? "").includes(line));

      expect(added.length).toBeGreaterThan(0);
    });
  });

  describe("when the package that owns the lists is read", () => {
    /** @scenario "The generated module lists have a home that type-checks" */
    it("depends on exactly the packages the server list imports", () => {
      const source = readFileSync(
        resolve(REPOSITORY_ROOT, "modules/server-modules.generated.ts"),
        "utf8",
      );
      const imported = [...source.matchAll(/from "(@langwatch\/[^"]+)";/g)].map(
        (match) => match[1],
      );
      const owner = JSON.parse(
        readFileSync(resolve(REPOSITORY_ROOT, "modules/package.json"), "utf8"),
      ) as { dependencies: Record<string, string> };

      expect(Object.keys(owner.dependencies).sort()).toEqual([...imported].sort());
    });
  });
});
