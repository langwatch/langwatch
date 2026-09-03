import { describe, expect, it, vi } from "vitest";
import { RuntimeBoot } from "../src";

describe("RuntimeBoot", () => {
  it("resolves configuration and starts transport only after readiness", async () => {
    const phases: string[] = [];
    const closeApplication = vi.fn(() => phases.push("close-application"));
    const closeTransport = vi.fn(() => phases.push("close-transport"));
    const boot = new RuntimeBoot<
      { port: number },
      { close: () => void },
      Record<string, never>
    >({
      config: { resolve: (source) => ({ port: Number(source.PORT) }) },
      createInfrastructure: () => {
        phases.push("infrastructure");
        return {};
      },
      createApplication: (config) => {
        phases.push(`application:${config.port}`);
        return { close: closeApplication };
      },
      initializeApplication: () => {
        phases.push("initialize");
      },
      checkReadiness: () => {
        phases.push("ready");
      },
      startTransport: () => {
        phases.push("start");
        return {
          close: () => {
            closeTransport();
          },
        };
      },
    });

    const runtime = await boot.boot({ PORT: "6560" });
    expect(phases).toEqual([
      "infrastructure",
      "application:6560",
      "initialize",
      "ready",
      "start",
    ]);

    await runtime.close();
    await runtime.close();
    expect(phases).toEqual([
      "infrastructure",
      "application:6560",
      "initialize",
      "ready",
      "start",
      "close-transport",
      "close-application",
    ]);
    expect(closeTransport).toHaveBeenCalledOnce();
    expect(closeApplication).toHaveBeenCalledOnce();
  });

  it("cleans resources when readiness refuses boot", async () => {
    const closeApplication = vi.fn();
    const closeInfrastructure = vi.fn();
    const boot = new RuntimeBoot({
      config: { resolve: () => ({}) },
      createInfrastructure: (_config, resources) => {
        resources.own("database", closeInfrastructure);
        return {};
      },
      createApplication: () => ({ close: closeApplication }),
      checkReadiness: () => {
        throw new Error("dependency unavailable");
      },
    });

    await expect(boot.boot({})).rejects.toThrow("dependency unavailable");
    expect(closeApplication).toHaveBeenCalledOnce();
    expect(closeInfrastructure).toHaveBeenCalledOnce();
  });

  it("does not construct resources when configuration resolution fails", async () => {
    const createInfrastructure = vi.fn();
    const boot = new RuntimeBoot({
      config: {
        resolve: () => {
          throw new Error("invalid config");
        },
      },
      createInfrastructure,
      createApplication: () => ({}),
    });

    await expect(boot.boot({})).rejects.toThrow("invalid config");
    expect(createInfrastructure).not.toHaveBeenCalled();
  });
});
