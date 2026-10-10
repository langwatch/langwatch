import { isProcessModule, processConfig } from "@langwatch/process";
import { describe, expect, it } from "vitest";

import { processModules } from "../process-modules.generated.ts";

describe("the modules a container takes from the server's config", () => {
  it("keeps every installed module that projects browser config", () => {
    const owners = processConfig(processModules);
    const kept = new Set(owners.filter(isProcessModule).map((module) => module.name));
    const projecting = processModules.filter((module) => module.publicConfig);

    expect(projecting.length).toBeGreaterThan(0);
    expect(projecting.filter((module) => !kept.has(module.name))).toEqual([]);
    expect(kept.has("ops")).toBe(true);
  });

  it("keeps all installed modules and none of the framework owners", () => {
    const kept = processConfig(processModules).filter(isProcessModule);

    expect(kept).toHaveLength(processModules.length);
  });
});
