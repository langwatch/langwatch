import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(file: string): string {
  return readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
}

describe("executable import boundaries", () => {
  it("loads environment files from the executable boot function", () => {
    for (const file of ["server.mts", "workers.ts", "task.ts"]) {
      const code = source(file);
      expect(code).not.toMatch(/^import ["']\.\/env-load["'];?$/m);
      expect(code).toContain('await import("./env-load")');
      expect(code).toContain("loadEnvironment()");
    }
  });

  it("does not expose a resolved env singleton from the new boot seam", () => {
    const config = source("runtime/config.ts");
    const boot = source("runtime/app/boot.ts");
    expect(config).not.toContain("process.env");
    expect(boot).not.toContain("process.env");
    expect(boot).toContain("new RuntimeBoot");
  });

  it("starts a supplied AppRuntime at the single HTTP boot seam", () => {
    const start = source("start.ts");
    const server = source("server.mts");

    expect(start).toContain("await appRuntime.start();");
    expect(start).not.toMatch(/if \(!options\.appRuntime\).*appRuntime\.start/);
    expect(server).not.toContain("await appRuntime.start();");
  });
});
