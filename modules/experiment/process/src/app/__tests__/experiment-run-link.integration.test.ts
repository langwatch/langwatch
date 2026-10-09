/**
 * The run link's origin at boot: NEXT_PUBLIC_BASE_URL still works when BASE_HOST is unset,
 * and the process warns once that it is deprecated.
 * @vitest-environment node
 */
import type * as observabilityModule from "@langwatch/observability";
import { describe, expect, it, vi } from "vitest";

const logged = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }));

vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof observabilityModule>()),
  createLogger: () => logged,
}));

// `isolate: false`: a sibling may have loaded the module with the real logger already.
vi.resetModules();

const { EventSourcing, InMemoryProcessStore } = await import("@langwatch/eventing");
const { createApp } = await import("@langwatch/process");
const { memoryStores } = await import("@langwatch/process-stores");
const { createTestLogger } = await import("@langwatch/test-harness");
const { createApiFixture } = await import("@langwatch/test-harness/api-fixture");
const { experimentProcessModule } = await import("../../experiment.module.ts");

const deprecations = () =>
  logged.warn.mock.calls.filter(([, message]) => String(message).includes("NEXT_PUBLIC_BASE_URL"));

async function bootWith({
  publicBaseUrl,
  legacyPublicBaseUrl,
}: {
  publicBaseUrl: string | undefined;
  legacyPublicBaseUrl: string | undefined;
}) {
  logged.warn.mockClear();
  const runtime = await createApp({ role: "worker" })
    .withModules([experimentProcessModule])
    .withStores(memoryStores())
    .withEventing(
      new EventSourcing({
        enabled: false,
        participation: "consume",
        processStore: InMemoryProcessStore.createForTesting(),
      }),
    )
    .withConfig({
      experiment: {
        foldCacheTtlSeconds: 300,
        blockLocalHttpCalls: false,
        allowedProxyHosts: [],
        runConcurrency: 10,
        publicBaseUrl,
        legacyPublicBaseUrl,
        isSaas: false,
      },
    })
    .withObservability((observability) => observability.withLogging(createTestLogger().logger))
    .provide({
      workflow: createApiFixture({}),
      dataset: createApiFixture({}),
      monitor: createApiFixture({}),
      agent: createApiFixture({}),
      evaluator: createApiFixture({}),
      prompt: createApiFixture({}),
      authz: createApiFixture({}),
      presence: createApiFixture({}),
      project: createApiFixture({}),
      entitlement: createApiFixture({}),
      evaluation: createApiFixture({}),
      "api-key": createApiFixture({}),
      "stored-object": createApiFixture({}),
      trace: createApiFixture({}),
      "model-provider": createApiFixture({}),
      "data-retention": createApiFixture({}),
    })
    .boot();
  await runtime.stop();
}

describe("experiment's run link origin at boot", () => {
  /** @scenario "A run link falls back to NEXT_PUBLIC_BASE_URL with one deprecation warning" */
  it("warns once when only NEXT_PUBLIC_BASE_URL is set", async () => {
    await bootWith({ publicBaseUrl: undefined, legacyPublicBaseUrl: "https://old.test" });

    expect(deprecations()).toHaveLength(1);
    expect(String(deprecations()[0]?.[1])).toContain("removed in a future release");
  });

  it("stays quiet when BASE_HOST is set", async () => {
    await bootWith({ publicBaseUrl: "https://base.test", legacyPublicBaseUrl: "https://old.test" });

    expect(deprecations()).toEqual([]);
  });
});
