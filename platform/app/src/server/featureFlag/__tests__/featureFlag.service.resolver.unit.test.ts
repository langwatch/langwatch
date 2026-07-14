/**
 * @vitest-environment node
 *
 * Resolver-level coverage for the registry-driven feature flag service.
 *
 * Uses an in-memory store double instead of postgres because the only
 * Prisma surface area is a single `findUnique` and `upsert`, so Prisma
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
import {
  evaluateRules,
  type FeatureFlagRules,
  type RuleEvaluationContext,
} from "../rules";
import type { FeatureFlagServiceInterface } from "../types";

const SYSTEM_FLAG = "ops_es_causality_loop_guard_disabled";
const FAMILY_FLAG = "es-trace-projection-spanstorage-killswitch";
const PRODUCT_FLAG = "release_ui_ai_gateway_menu_enabled";
const UNREGISTERED_FLAG = "experiment_some_adhoc_posthog_flag";

class InMemoryStore {
  private values = new Map<
    string,
    { enabled: boolean; rules: FeatureFlagRules }
  >();
  async get(
    key: string,
    ctx: RuleEvaluationContext = {},
  ): Promise<boolean | null> {
    const row = this.values.get(key);
    if (!row) return null;
    const ruleHit = evaluateRules(row.rules, ctx);
    return ruleHit ?? row.enabled;
  }
  async set(key: string, enabled: boolean): Promise<void> {
    const existing = this.values.get(key);
    this.values.set(key, { enabled, rules: existing?.rules ?? [] });
  }
  async setRules(key: string, rules: FeatureFlagRules): Promise<void> {
    const existing = this.values.get(key);
    this.values.set(key, { enabled: existing?.enabled ?? false, rules });
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
    // Store double matching FeatureFlagStorePostgres shape; we only
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
        const enabled = await service.isEnabled(SYSTEM_FLAG, { distinctId: "tenant-a", defaultValue: true });
        expect(enabled).toBe(false);
        expect(legacy.isEnabled).not.toHaveBeenCalled();
      });
    });

    describe("when the postgres store has a value", () => {
      it("uses the store value and never calls the legacy service", async () => {
        const { service, store, legacy } = buildService();
        await store.set(SYSTEM_FLAG, true);
        const enabled = await service.isEnabled(SYSTEM_FLAG, { distinctId: "tenant-a", defaultValue: false });
        expect(enabled).toBe(true);
        expect(legacy.isEnabled).not.toHaveBeenCalled();
      });
    });

    describe("when the standard env override is set", () => {
      it("beats the store value", async () => {
        const { service, store, legacy } = buildService();
        await store.set(SYSTEM_FLAG, false);
        process.env.OPS_ES_CAUSALITY_LOOP_GUARD_DISABLED = "1";
        const enabled = await service.isEnabled(SYSTEM_FLAG, { distinctId: "tenant-a", defaultValue: false });
        expect(enabled).toBe(true);
        expect(legacy.isEnabled).not.toHaveBeenCalled();
      });
    });

    describe("when the legacy env alias is set", () => {
      it("honors LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD for back-compat", async () => {
        const { service, legacy } = buildService();
        process.env.LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD = "1";
        const enabled = await service.isEnabled(SYSTEM_FLAG, { distinctId: "tenant-a", defaultValue: false });
        expect(enabled).toBe(true);
        expect(legacy.isEnabled).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a SYSTEM family-prefixed flag", () => {
    describe("when no store row exists", () => {
      it("resolves to family default off and skips the legacy service", async () => {
        const { service, legacy } = buildService();
        const enabled = await service.isEnabled(FAMILY_FLAG, { distinctId: "tenant-a", defaultValue: false });
        expect(enabled).toBe(false);
        expect(legacy.isEnabled).not.toHaveBeenCalled();
      });
    });

    describe("when an operator flips the kill switch on via the store", () => {
      it("returns true and still skips the legacy service", async () => {
        const { service, store, legacy } = buildService();
        await store.set(FAMILY_FLAG, true);
        const enabled = await service.isEnabled(FAMILY_FLAG, { distinctId: "tenant-a", defaultValue: false });
        expect(enabled).toBe(true);
        expect(legacy.isEnabled).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a PRODUCT-scoped flag", () => {
    describe("when no store row exists", () => {
      it("delegates to the legacy (PostHog) service", async () => {
        const { service, legacy } = buildService();
        (legacy.isEnabled as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
          true,
        );
        const enabled = await service.isEnabled(PRODUCT_FLAG, {
          distinctId: "user-1",
          defaultValue: false,
        });
        expect(enabled).toBe(true);
        expect(legacy.isEnabled).toHaveBeenCalledWith(PRODUCT_FLAG, {
          distinctId: "user-1",
          defaultValue: true,
        });
      });
    });

    describe("when an operator override row exists in the store", () => {
      it("uses the store value without touching the legacy service", async () => {
        const { service, store, legacy } = buildService();
        await store.set(PRODUCT_FLAG, true);
        const enabled = await service.isEnabled(PRODUCT_FLAG, { distinctId: "user-1", defaultValue: false });
        expect(enabled).toBe(true);
        expect(legacy.isEnabled).not.toHaveBeenCalled();
      });
    });

    describe("when an operator disables a PRODUCT flag via the store", () => {
      it("returns false even when PostHog would have said true", async () => {
        const { service, store, legacy } = buildService();
        await store.set(PRODUCT_FLAG, false);
        (legacy.isEnabled as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
          true,
        );
        const enabled = await service.isEnabled(PRODUCT_FLAG, { distinctId: "user-1", defaultValue: true });
        expect(enabled).toBe(false);
        expect(legacy.isEnabled).not.toHaveBeenCalled();
      });
    });

    describe("when the store row carries an org-scoped targeting rule", () => {
      it("uses the rule for the matching org and skips PostHog", async () => {
        const { service, store, legacy } = buildService();
        await store.setRules(PRODUCT_FLAG, [
          { match: { organizationId: "org_lw" }, enabled: true },
        ]);
        const enabled = await service.isEnabled(PRODUCT_FLAG, {
          distinctId: "user-1",
          organizationId: "org_lw",
          defaultValue: false,
        });
        expect(enabled).toBe(true);
        expect(legacy.isEnabled).not.toHaveBeenCalled();
      });

      it("uses the row-level default for a non-matching org without consulting PostHog", async () => {
        // The store creates a row with row-level enabled=false when only
        // rules are written, so the row counts as an explicit operator
        // override and stops the PostHog fallthrough. To target an
        // allowlist while still letting PostHog drive everyone else,
        // operators must leave the row absent — that's by design.
        const { service, store, legacy } = buildService();
        await store.setRules(PRODUCT_FLAG, [
          { match: { organizationId: "org_lw" }, enabled: true },
        ]);
        const enabled = await service.isEnabled(PRODUCT_FLAG, {
          distinctId: "user-1",
          organizationId: "org_other",
          defaultValue: false,
        });
        expect(enabled).toBe(false);
        expect(legacy.isEnabled).not.toHaveBeenCalled();
      });
    });

    describe("when the row carries both a row-level default and a non-matching rule", () => {
      it("uses the row-level default (PostHog is not consulted because the row exists)", async () => {
        const { service, store, legacy } = buildService();
        await store.set(PRODUCT_FLAG, false);
        await store.setRules(PRODUCT_FLAG, [
          { match: { organizationId: "org_other" }, enabled: true },
        ]);
        const enabled = await service.isEnabled(PRODUCT_FLAG, {
          distinctId: "user-1",
          organizationId: "org_self",
          defaultValue: true,
        });
        expect(enabled).toBe(false);
        expect(legacy.isEnabled).not.toHaveBeenCalled();
      });
    });
  });

  describe("given an unregistered flag", () => {
    it("falls through to the legacy service so ad-hoc PostHog flags still work", async () => {
      const { service, legacy } = buildService();
      (legacy.isEnabled as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        true,
      );
      // Cast: deliberately a non-registered flag to assert the
      // legacy-fallback path. Production callers can't reach this branch
      // because the FeatureFlagKey signature wouldn't accept the key.
      const enabled = await service.isEnabled(UNREGISTERED_FLAG as never, {
        distinctId: "user-1",
        defaultValue: false,
      });
      expect(enabled).toBe(true);
      expect(legacy.isEnabled).toHaveBeenCalled();
    });
  });
});
