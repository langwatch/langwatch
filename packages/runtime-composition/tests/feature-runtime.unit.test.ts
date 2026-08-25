import { describe, expect, it, vi } from "vitest";
import { Capability, FeatureDefinition, FeatureRuntimeBuilder } from "../src";

const build = <Infrastructure>(
  features: readonly FeatureDefinition<Infrastructure>[],
  infrastructure: Infrastructure,
  target: "app" | "worker" = "app",
) => FeatureRuntimeBuilder.create({ infrastructure }).build({ features, target });

describe("runtime feature composition", () => {
  /** @scenario Missing feature requirements fail during build */
  it("rejects a missing requirement before installing services or adapters", async () => {
    const missing = Capability.create<string>("missing");
    const install = vi.fn();
    const app = vi.fn();
    const feature = FeatureDefinition.create({
      name: "consumer",
      requires: [missing],
      services: install,
      app,
    });

    await expect(build([feature], {})).rejects.toThrow(
      'Feature "consumer" requires missing capability "missing"',
    );
    expect(install).not.toHaveBeenCalled();
    expect(app).not.toHaveBeenCalled();
  });

  /** @scenario Duplicate capability providers fail during build */
  it("rejects duplicate providers before installing either feature", async () => {
    const service = Capability.create<string>("service");
    const firstInstall = vi.fn();
    const secondInstall = vi.fn();
    const first = FeatureDefinition.create({
      name: "first",
      provides: [service],
      services: firstInstall,
    });
    const second = FeatureDefinition.create({
      name: "second",
      provides: [service],
      services: secondInstall,
    });

    await expect(build([first, second], {})).rejects.toThrow(
      'Capability "service" is declared by both "first" and "second"',
    );
    expect(firstInstall).not.toHaveBeenCalled();
    expect(secondInstall).not.toHaveBeenCalled();
  });

  /** @scenario The interactive app has a closed capability graph */
  it("installs dependencies in graph order and exposes the sealed result", async () => {
    const database = Capability.create<{ ready: true }>("database");
    const service = Capability.create<string>("service");
    const calls: string[] = [];
    const consumer = FeatureDefinition.create({
      name: "consumer",
      requires: [database],
      provides: [service],
      services: ({ provide, require }) => {
        calls.push("consumer");
        expect(require(database)).toEqual({ ready: true });
        provide(service, "ready");
      },
    });
    const provider = FeatureDefinition.create({
      name: "provider",
      provides: [database],
      services: ({ provide }) => {
        calls.push("provider");
        provide(database, { ready: true });
      },
    });

    const runtime = await build([consumer, provider], {});

    expect(calls).toEqual(["provider", "consumer"]);
    expect(runtime.registry.require(service)).toBe("ready");
    expect(runtime.registry.isSealed()).toBe(true);
  });

  /** @scenario A built registry cannot be mutated */
  it("seals the registry before target-specific adapters run", async () => {
    const service = Capability.create<string>("service");
    let provideLate: () => void = () => {
      throw new Error("service installer did not run");
    };
    const feature = FeatureDefinition.create({
      name: "provider",
      provides: [service],
      services: ({ provide }) => {
        provide(service, "ready");
        provideLate = () => provide(service, "replacement");
      },
      app: ({ require }) => {
        expect(require(service)).toBe("ready");
        expect(provideLate).toThrow("registry is sealed");
      },
    });

    const runtime = await build([feature], {});

    expect(runtime.registry.isSealed()).toBe(true);
  });

  it("rejects undeclared requirements and contributions", async () => {
    const available = Capability.create<string>("available");
    const hidden = Capability.create<string>("hidden");
    const provider = FeatureDefinition.create({
      name: "provider",
      provides: [available],
      services: ({ provide }) => provide(available, "ready"),
    });
    const undeclaredRequirement = FeatureDefinition.create({
      name: "undeclared-requirement",
      services: ({ require }) => {
        require(available);
      },
    });
    const undeclaredContribution = FeatureDefinition.create({
      name: "undeclared-contribution",
      services: ({ provide }) => provide(hidden, "hidden"),
    });

    await expect(build([provider, undeclaredRequirement], {})).rejects.toThrow(
      'Feature "undeclared-requirement" required undeclared capability "available"',
    );
    await expect(build([undeclaredContribution], {})).rejects.toThrow(
      'Feature "undeclared-contribution" provided undeclared capability "hidden"',
    );
  });

  it("rejects a feature that does not install its declared capability", async () => {
    const missing = Capability.create<string>("not-installed");
    const feature = FeatureDefinition.create({
      name: "incomplete",
      provides: [missing],
      services: () => undefined,
    });

    await expect(build([feature], {})).rejects.toThrow(
      'Feature "incomplete" did not install declared capability "not-installed"',
    );
  });

  /** @scenario Feature imports have no registration side effects */
  it("does nothing until build and invokes only the selected target hook", async () => {
    const install = vi.fn();
    const app = vi.fn();
    const worker = vi.fn();
    const feature = FeatureDefinition.create({
      name: "targeted",
      services: install,
      app,
      worker,
    });

    expect(install).not.toHaveBeenCalled();
    expect(app).not.toHaveBeenCalled();
    expect(worker).not.toHaveBeenCalled();

    await build([feature], {}, "worker");

    expect(install).toHaveBeenCalledOnce();
    expect(worker).toHaveBeenCalledOnce();
    expect(app).not.toHaveBeenCalled();
  });
});
