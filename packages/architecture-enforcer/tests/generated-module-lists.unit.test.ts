import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../..");
const DEVSCRIPTS = join(REPOSITORY_ROOT, "dev/scripts/devscripts.sh");
const SERVER_MODULES = "packages/installed-server-modules/src/server-modules.generated.ts";
const scratch: string[] = [];

afterAll(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true });
});

function generateModules({ args }: { args: string[] }): void {
  execFileSync("bash", [DEVSCRIPTS, "generate-modules", ...args], { stdio: "pipe" });
}

/** One module on disk, as the generator reads it: a catalogue and an App. */
function moduleTree(app: string): string {
  const root = mkdtempSync(join(tmpdir(), "installed-modules-"));
  scratch.push(root);
  const server = join(root, "modules/annotation/process/src/app");
  mkdirSync(server, { recursive: true });
  writeFileSync(
    join(root, "modules/catalogue.json"),
    JSON.stringify({
      version: 0,
      features: [{ id: "annotation", root: "modules/annotation" }],
    }),
  );
  // The generator rewrites these packages' dependencies, so they have to exist.
  for (const half of ["server", "web"]) {
    mkdirSync(join(root, `packages/installed-${half}-modules/src`), { recursive: true });
    writeFileSync(
      join(root, `packages/installed-${half}-modules/package.json`),
      `{"name":"@langwatch/installed-${half}-modules","dependencies":{}}`,
    );
  }
  writeFileSync(join(root, "modules/annotation/process/package.json"), '{"name":"x"}');
  writeFileSync(join(server, "annotation.app.ts"), app);
  return root;
}

/** What the generator wrote for the one module in that tree. */
function membersIn(root: string): string {
  generateModules({ args: ["--root", root] });
  return readFileSync(
    join(root, "packages/installed-server-modules/src/server-module-members.generated.ts"),
    "utf8",
  );
}

function checkedIn(path: string): string {
  return readFileSync(resolve(REPOSITORY_ROOT, path), "utf8");
}

describe("given the checked-in module lists", () => {
  describe("when the generator runs again over the catalogue", () => {
    it("writes exactly what is checked in", () => {
      expect(() => generateModules({ args: ["--check"] })).not.toThrow();
    });

    /**
     * One build carries every module. A licence lives in the running
     * application, so an enterprise module is installed like any other and a
     * deployment without one is refused at the door, not by an absent route.
     *
     * @scenario "The module list is generated from the catalogue"
     */
    it("installs the enterprise modules beside the core ones", () => {
      // Named rather than derived: a tier gate coming back drops these three.
      for (const module of ["governance", "scim", "licensing"]) {
        expect(checkedIn(SERVER_MODULES)).toContain(`@langwatch/enterprise-${module}-process`);
      }
    });

    it("reads each module's members off the `reads` its App declared", () => {
      const root = moduleTree(`
        export class AnnotationApp {
          static readonly contract = AnnotationApi;
          static readonly reads = ["clock", "logger"] as const;
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
      const imported = [...checkedIn(SERVER_MODULES).matchAll(/from "(@langwatch\/[^"]+)";/g)].map(
        (match) => match[1],
      );

      expect(imported.length).toBeGreaterThan(0);
      expect(imported.length).toBe(new Set(imported).size);
    });
  });

  describe("when the package that owns the lists is read", () => {
    /** @scenario "The generated module lists have a home that type-checks" */
    it("depends on exactly the packages the server list imports, and the kernel", () => {
      const imported = [...checkedIn(SERVER_MODULES).matchAll(/from "(@langwatch\/[^"]+)";/g)].map(
        (match) => match[1] ?? "",
      );
      const owner = JSON.parse(checkedIn("packages/installed-server-modules/package.json")) as {
        dependencies: Record<string, string>;
      };

      // The generator keeps the kernel declared on the server half (generatemodules.go).
      expect(Object.keys(owner.dependencies).toSorted((a, b) => a.localeCompare(b))).toEqual(
        [...imported, "@langwatch/kernel"].toSorted((a, b) => a.localeCompare(b)),
      );
    });
  });
});
