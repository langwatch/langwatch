import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../..");
const DEVSCRIPTS = join(REPOSITORY_ROOT, "dev/scripts/devscripts.sh");
const PROCESS_APPS = ["api", "worker", "tasks"] as const;
const processList = (app: string) => `apps/${app}/src/process-modules.generated.ts`;
const SERVER_MODULES = processList("api");
const BROWSER_MODULES = "apps/ui/src/browser-modules.generated.ts";

function generateModules({ args }: { args: string[] }): void {
  execFileSync("bash", [DEVSCRIPTS, "generate-modules", ...args], { stdio: "pipe" });
}

function checkedIn(path: string): string {
  return readFileSync(resolve(REPOSITORY_ROOT, path), "utf8");
}

function importedPackages(path: string): string[] {
  return [...checkedIn(path).matchAll(/from "(@langwatch\/[^"]+)";/g)].map(
    (match) => match[1] ?? "",
  );
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

    it("names each installed module exactly once", () => {
      const imported = importedPackages(SERVER_MODULES);

      expect(imported.length).toBeGreaterThan(0);
      expect(imported.length).toBe(new Set(imported).size);
    });

    it("gives api, worker and tasks the same process list", () => {
      for (const app of PROCESS_APPS) {
        expect(importedPackages(processList(app))).toEqual(importedPackages(SERVER_MODULES));
      }
    });
  });

  describe("when each app's manifest is read", () => {
    it("declares every package its generated list imports", () => {
      const lists = [
        ...PROCESS_APPS.map((app) => ({ app, list: processList(app) })),
        { app: "ui", list: BROWSER_MODULES },
      ];

      for (const { app, list } of lists) {
        const owner = JSON.parse(checkedIn(`apps/${app}/package.json`)) as {
          dependencies: Record<string, string>;
        };
        const imported = new Set(
          importedPackages(list).map((name) => name.split("/").slice(0, 2).join("/")),
        );

        for (const name of imported) expect(owner.dependencies).toHaveProperty([name]);
      }
    });
  });
});
