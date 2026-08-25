import {
  GovernancePuller,
  type PullResult,
  type PullRunOptions,
} from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";
import { PullerRegistryService } from "../src/services/puller-registry.service";

class TestPuller extends GovernancePuller<{ token: string }> {
  readonly id = "test";

  validateConfig(config: unknown): { token: string } {
    if (
      typeof config !== "object" ||
      config === null ||
      !("token" in config) ||
      typeof config.token !== "string"
    ) {
      throw new Error("token is required");
    }
    return { token: config.token };
  }

  async runOnce(
    options: PullRunOptions,
    config: { token: string },
  ): Promise<PullResult> {
    return {
      events: [],
      cursor: `${config.token}:${options.cursor ?? "first"}`,
      errorCount: 0,
    };
  }
}

describe("PullerRegistryService", () => {
  it("registers and resolves a typed puller", async () => {
    const registry = PullerRegistryService.create();
    const puller = new TestPuller();

    registry.register(puller);

    const resolved = registry.tryGet("test");
    const config = resolved?.validateConfig({ token: "secret" });
    await expect(
      resolved?.runOnce({ cursor: "next" }, config),
    ).resolves.toMatchObject({ cursor: "secret:next" });
    expect(registry.ids()).toEqual(["test"]);
  });

  it("rejects duplicate adapter ids", () => {
    const registry = PullerRegistryService.create();
    registry.register(new TestPuller());

    expect(() => registry.register(new TestPuller())).toThrow(
      'PullerAdapter "test" is already registered',
    );
  });

  it("clears registrations", () => {
    const registry = PullerRegistryService.create();
    registry.register(new TestPuller());

    registry.clear();

    expect(registry.tryGet("test")).toBeUndefined();
    expect(registry.ids()).toEqual([]);
  });
});
