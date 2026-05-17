/**
 * @vitest-environment node
 *
 * Resolver-level coverage for the registry-driven feature flag service.
 *
 * Uses an in-memory store double instead of postgres because the only
 * Prisma surface area is a single `findUnique` and `upsert` — Prisma
 * itself doesn't need re-testing. The interesting behaviour is the
 * resolver's branching across env / store / legacy / registry-default,
 * and especially the load-bearing invariant that SYSTEM-scoped flags
 * never reach the legacy (PostHog) sub-service. The legacy service is
 * a `vi.fn()` so the test can assert that with `not.toHaveBeenCalled`.
 *
 * Real-postgres coverage is sufficient via direct Prisma store tests
 * (see featureFlagStore.postgres.integration when re-enabled with a
 * green test-container stack).
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { FeatureFlagService } from "../featureFlag.service";
import type { FeatureFlagStorePostgres } from "../featureFlagStore.postgres";
import type { FeatureFlagServiceInterface } from "../types";

const SYSTEM_FLAG = "ops_es_causality_loop_guard_disabled";
const FAMILY_FLAG = "es-trace-projection-spanstorage-killswitch";
const PRODUCT_FLAG = "release_nlp_go_engine_enabled";
const UNREGISTERED_FLAG = "experiment_some_adhoc_posthog_flag";

class InMemoryStore {
  private values = new Map<string, boolean>();
  async get(key: string): Promise<boolean | null> {
    return this.values.has(key) ? this.values.get(key)! : null;
  }
  async set(key: string, enabled: boolean): Promise<void> {
    this.values.set(key, enabled);
  }
  async clear(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function buildService() {
  const legacy: FeatureFlagServiceInterface = {
    isEnabled: vi.fn().mockResolvedValue(false),
  };
  const store = new InMemoryStore();
  const service = new FeatureFlagService({
    legacy,
    // Store double — same shape as FeatureFlagStorePostgres; we only
    // exercise the resolver path so the additional methods are unused.
    store: store as unknown as FeatureFlagStorePostgres,
  });
  return { service, legacy, store };
}

describe("FeatureFlagService", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPS_ES_CAUSALITY_LOOP_GUARD_DISABLED;
    delete process.env.LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD;
    delete process.env.RELEASE_NLP_GO_ENGINE_ENABLED;
    delete process.env.ES_TRACE_PROJECTION_SPANSTORAGE_KILLSWITCH;
    delete process.env.FEATURE_FLAG_FORCE_ENABLE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("given a SYSTEM-scoped flag", () => {
    describe("when nothing overrides it", () => {
      it("resolves to the registry default and never calls the legacy service", async () => {
        const { service, legacy } = buildService();
        const enabled = await service.isEnabled(SYSTEM_FLAG, "tenant-a", true);
        expect(enabled).toBe(false);
        expect(legacy.isEnabled).not.toHaveBeenCalled();
      });
    });

    describe("when the postgres store has a value", () => {
      it("uses the store value and never calls the legacy service", async () => {
        const { service, store, legacy } = buildService();
        await store.set(SYSTEM_FLAG, true);
        const enabled = await service.isEnabled(SYSTEM_FLAG, "tenant-a", false);
        expect(enabled).toBe(true);
        expect(legacy.isEnabled).not.toHaveBeenCalled();
      });
    });

    describe("when the standard env override is set", () => {
      it("beats the store value", async () => {
        const { service, store, legacy } = buildService();
        await store.set(SYSTEM_FLAG, false);
        process.env.OPS_ES_CAUSALITY_LOOP_GUARD_DISABLED = "1";
        const enabled = await service.isEnabled(SYSTEM_FLAG, "tenant-a", false);
        expect(enabled).toBe(true);
        expect(legacy.isEnabled).not.toHaveBeenCalled();
      });
    });

    describe("when the legacy env alias is set", () => {
      it("honors LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD for back-compat", async () => {
        const { service, legacy } = buildService();
        process.env.LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD = "1";
        const enabled = await service.isEnabled(SYSTEM_FLAG, "tenant-a", false);
        expect(enabled).toBe(true);
        expect(legacy.isEnabled).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a SYSTEM family-prefixed flag", () => {
    describe("when no store row exists", () => {
      it("resolves to family default off and skips the legacy service", async () => {
        const { service, legacy } = buildService();
        const enabled = await service.isEnabled(FAMILY_FLAG, "tenant-a", false);
        expect(enabled).toBe(false);
        expect(legacy.isEnabled).not.toHaveBeenCalled();
      });
    });

    describe("when an operator flips the kill switch on via the store", () => {
      it("returns true and still skips the legacy service", async () => {
        const { service, store, legacy } = buildService();
        await store.set(FAMILY_FLAG, true);
        const enabled = await service.isEnabled(FAMILY_FLAG, "tenant-a", false);
        expect(enabled).toBe(true);
        expect(legacy.isEnabled).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a PRODUCT-scoped flag", () => {
    describe("when the legacy service answers", () => {
      it("delegates to the legacy (PostHog) service", async () => {
        const { service, legacy } = buildService();
        (legacy.isEnabled as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
          true,
        );
        const enabled = await service.isEnabled(PRODUCT_FLAG, "user-1", false);
        expect(enabled).toBe(true);
        expect(legacy.isEnabled).toHaveBeenCalledWith(
          PRODUCT_FLAG,
          "user-1",
          false,
          undefined,
        );
      });
    });

    describe("when the legacy service throws and a store value exists", () => {
      it("falls back to the store value (self-hosted parity)", async () => {
        const { service, store, legacy } = buildService();
        await store.set(PRODUCT_FLAG, true);
        (legacy.isEnabled as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
          new Error("PostHog unreachable"),
        );
        const enabled = await service.isEnabled(PRODUCT_FLAG, "user-1", false);
        expect(enabled).toBe(true);
      });
    });
  });

  describe("given an unregistered flag", () => {
    it("falls through to the legacy service so ad-hoc PostHog flags still work", async () => {
      const { service, legacy } = buildService();
      (legacy.isEnabled as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        true,
      );
      const enabled = await service.isEnabled(
        UNREGISTERED_FLAG,
        "user-1",
        false,
      );
      expect(enabled).toBe(true);
      expect(legacy.isEnabled).toHaveBeenCalled();
    });
  });
});
