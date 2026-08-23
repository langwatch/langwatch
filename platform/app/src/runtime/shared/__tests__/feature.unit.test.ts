import { describe, expect, it, vi } from "vitest";
import { CapabilityRegistry, capability } from "../capabilities";
import { buildFeatureRuntime, defineFeature } from "../feature";

describe("runtime feature composition", () => {
  /** @scenario Missing feature requirements fail during build */
  it("rejects a missing requirement before installing services", async () => {
    const missing = capability<string>("missing");
    const install = vi.fn();
    const feature = defineFeature({
      name: "consumer",
      requires: [missing],
      services: install,
    });

    await expect(
      buildFeatureRuntime({
        features: [feature],
        infrastructure: {},
        target: "app",
      }),
    ).rejects.toThrow(
      'Feature "consumer" requires missing capability "missing"',
    );
    expect(install).not.toHaveBeenCalled();
  });

  /** @scenario Duplicate capability providers fail during build */
  it("rejects duplicate providers before installing either feature", async () => {
    const service = capability<string>("service");
    const firstInstall = vi.fn();
    const secondInstall = vi.fn();
    const first = defineFeature({
      name: "first",
      provides: [service],
      services: firstInstall,
    });
    const second = defineFeature({
      name: "second",
      provides: [service],
      services: secondInstall,
    });

    await expect(
      buildFeatureRuntime({
        features: [first, second],
        infrastructure: {},
        target: "app",
      }),
    ).rejects.toThrow(
      'Capability "service" is declared by both "first" and "second"',
    );
    expect(firstInstall).not.toHaveBeenCalled();
    expect(secondInstall).not.toHaveBeenCalled();
  });

  /** @scenario A built registry cannot be mutated */
  it("seals the registry after runtime hooks are installed", async () => {
    const service = capability<string>("service");
    const feature = defineFeature({
      name: "provider",
      provides: [service],
      services: ({ provide }) => provide(service, "ready"),
    });
    const runtime = await buildFeatureRuntime({
      features: [feature],
      infrastructure: {},
      target: "app",
    });

    expect(runtime.registry.require(service)).toBe("ready");
    expect(runtime.registry.isSealed()).toBe(true);
    expect(() =>
      runtime.registry.provide(service, "replacement", "late"),
    ).toThrow("registry is sealed");
  });

  it("does not allow undeclared capabilities", () => {
    const registry = new CapabilityRegistry();
    registry.seal();
    expect(registry.isSealed()).toBe(true);
  });
});
