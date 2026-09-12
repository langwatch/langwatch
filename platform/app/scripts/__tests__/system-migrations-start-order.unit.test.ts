import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";

describe("start.sh system migration ordering", () => {
  it("runs system migrations after schemas and before constructing runtime lanes", () => {
    const source = readFileSync(
      new URL("../start.sh", import.meta.url),
      "utf8",
    );
    const preflight = source.indexOf("run_startup_preflight");
    const runtimeLanes = source.indexOf("COMMANDS=()");

    expect(source).toContain("set -eo pipefail");
    expect(preflight).toBeGreaterThan(-1);
    expect(runtimeLanes).toBeGreaterThan(preflight);
  });

  it("gates every supported app and worker entrypoint", () => {
    const source = readFileSync(
      new URL("../start.sh", import.meta.url),
      "utf8",
    );
    const wrapper = readFileSync(
      new URL("../start-runtime.sh", import.meta.url),
      "utf8",
    );
    for (const name of [
      "start:app",
      "start:app:dev",
      "start:workers",
      "start:workers:dev",
    ] as const) {
      expect(packageJson.scripts[name]).toContain("scripts/start-runtime.sh");
    }
    expect(packageJson.scripts["dev:worker"]).toContain("start:workers:dev");
    const devCompose = readFileSync(
      new URL("../../../../dev/compose.dev.yml", import.meta.url),
      "utf8",
    );
    expect(devCompose).not.toContain("pnpm exec tsx src/workers.ts");
    expect(devCompose).toContain("pnpm run start:workers:dev");
    expect(wrapper).not.toContain("LANGWATCH_STARTUP_PREFLIGHT_DONE");
    expect(wrapper.indexOf("start:prepare:db")).toBeLessThan(
      wrapper.indexOf("task system-migrations"),
    );
    expect(wrapper.indexOf("task system-migrations")).toBeLessThan(
      wrapper.indexOf('exec "$@"'),
    );
    expect(source).toContain("pnpm -s run runtime:app");
    expect(source).toContain("pnpm -s run runtime:workers");
    expect(source).not.toContain("pnpm -s run start:app");
    expect(source).not.toContain("pnpm -s run start:workers");
  });
});
