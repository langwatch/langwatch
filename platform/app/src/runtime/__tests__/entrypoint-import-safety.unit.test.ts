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

  it("keeps task process boot in the physical local-orchestrator executable", () => {
    const task = source("task.ts");

    expect(task).toContain('await import("@langwatch/server/task")');
    expect(task).toContain('await import("./runtime/task/legacy-platform-task.executor")');
    expect(task).not.toContain("resolveProcessBootstrapConfig");
    expect(task).not.toContain("configureLogger(");
    expect(task).not.toContain("runStandaloneTaskWithPrisma");
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
    expect(server).toContain("const composeApp = config.workersInProcess");
    expect(server).toContain("composeApp,");
    expect(server).not.toContain("initializeLegacy:");
    expect(server).not.toContain("await appRuntime.start();");
  });

  it("configures process-wide setup before HTTP boot validation", () => {
    const server = source("server.mts");
    const bootConfig = server.indexOf("new AppBootConfigService().resolve(process.env)");

    expect(bootConfig).toBeGreaterThan(-1);
    for (const setup of [
      "configureLogger(bootstrap.logger)",
      "setEnvironment(bootstrap.environment)",
      "initializeInstrumentation(bootstrap.telemetry)",
    ]) {
      expect(server.indexOf(setup)).toBeGreaterThan(-1);
      expect(server.indexOf(setup)).toBeLessThan(bootConfig);
    }
  });

  it("keeps worker composition inside its structured startup error path", () => {
    const workers = source("workers.ts");
    const startupTry = workers.indexOf("try {");
    const boot = workers.indexOf("await WorkerExecutable.boot({");
    const structuredFailureLog = workers.indexOf(
      'logger.error({ error }, "failed to start background workers")',
    );

    expect(startupTry).toBeGreaterThan(-1);
    expect(boot).toBeGreaterThan(startupTry);
    expect(structuredFailureLog).toBeGreaterThan(boot);
  });

  it("constructs workers through the external runtime seam", () => {
    const workers = source("workers.ts");

    expect(workers).toContain('await import("@langwatch/worker")');
    expect(workers).toContain('await import("./runtime/worker/packaged-worker.executable.adapter")');
    expect(workers).not.toContain('await import("./runtime/worker")');
  });
});
