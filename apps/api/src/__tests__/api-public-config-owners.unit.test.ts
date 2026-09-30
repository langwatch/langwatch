import { serverModules } from "@langwatch/installed-server-modules";
import { isProcessModule, processConfig } from "@langwatch/process-server";
import { describe, expect, it } from "vitest";

describe("the modules a container takes from the server's config", () => {
  it("keeps every installed module that projects browser config", () => {
    const owners = processConfig(serverModules);
    const kept = new Set(owners.filter(isProcessModule).map((module) => module.name));
    const projecting = serverModules.filter((module) => module.publicConfig);

    expect(projecting.length).toBeGreaterThan(0);
    expect(projecting.filter((module) => !kept.has(module.name))).toEqual([]);
    expect(kept.has("ops")).toBe(true);
  });

  it("keeps all installed modules and none of the framework owners", () => {
    const kept = processConfig(serverModules).filter(isProcessModule);

    expect(kept).toHaveLength(serverModules.length);
  });
});
