import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateModuleLists } from "@langwatch/dev-scripts/generate-modules";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../..");
const scratch: string[] = [];

afterAll(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true });
});

/** One module on disk, as the generator reads it: a catalogue and an App. */
function moduleTree(app: string): string {
  const root = mkdtempSync(join(tmpdir(), "installed-modules-"));
  scratch.push(root);
  const server = join(root, "modules/annotation/process/src/app");
  mkdirSync(server, { recursive: true });
  mkdirSync(join(root, "modules"), { recursive: true });
  writeFileSync(
    join(root, "modules/catalogue.json"),
    JSON.stringify({
      version: 0,
      features: [{ id: "annotation", root: "modules/annotation" }],
    }),
  );
  // The generator derives this file's dependencies, so it has to exist to be
  // rewritten. Without it `generateModuleLists` throws ENOENT on a scratch tree.
  writeFileSync(
    join(root, "modules/package.json"),
    '{"name":"@langwatch/installed-modules","dependencies":{}}',
  );
  writeFileSync(join(root, "modules/annotation/process/package.json"), '{"name":"x"}');
  writeFileSync(join(server, "annotation.app.ts"), app);
  return root;
}

/** What the generator wrote for the one module in that tree. */
function membersIn(root: string): string {
  const generated = generateModuleLists({ root });
  return generated["modules/server-module-members.generated.ts"] ?? "";
}

describe("given the checked-in module lists", () => {
  describe("when the generator runs again over the catalogue", () => {
    it("writes exactly what is checked in", () => {
      const generated = generateModuleLists({ root: REPOSITORY_ROOT });

      for (const [path, source] of Object.entries(generated)) {
        const checkedIn = readFileSync(resolve(REPOSITORY_ROOT, path), "utf8");
        expect(`${path}:\n${checkedIn}`).toBe(`${path}:\n${source}`);
      }
    });

    /**
     * One build carries every module. A licence lives in the running
     * application, against an organization, so an enterprise module is
     * installed like any other and a deployment without one is refused at the
     * door rather than by an absent route.
     *
     * @scenario "The module list is generated from the catalogue"
     */
    it("installs the enterprise modules beside the core ones", () => {
      const source =
        generateModuleLists({ root: REPOSITORY_ROOT })["modules/server-modules.generated.ts"] ?? "";

      // Named rather than derived from the catalogue: deriving the list here
      // would restate the generator's own four conditions and assert nothing.
      // A tier gate coming back drops these three, and that is the failure
      // this test exists to catch.
      for (const module of ["governance", "scim", "licensing"]) {
        expect(source).toContain(`@langwatch/enterprise-${module}-process`);
      }
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

    it("names each installed module exactly once", () => {
      const source =
        generateModuleLists({ root: REPOSITORY_ROOT })["modules/server-modules.generated.ts"] ?? "";
      const imported = [...source.matchAll(/from "(@langwatch\/[^"]+)";/g)].map(
        (match) => match[1],
      );

      expect(imported.length).toBeGreaterThan(0);
      expect(imported.length).toBe(new Set(imported).size);
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

      expect(Object.keys(owner.dependencies).toSorted()).toEqual([...imported].toSorted());
    });
  });
});
