/**
 * @vitest-environment node
 *
 * The legacy (in-memory) backend is built lazily, on the first
 * evaluation of an unregistered flag key. SYSTEM and PRODUCT flags
 * resolve entirely from env override / the postgres store / the
 * registry default and never reach it, so a process that only ever
 * evaluates registered flags never constructs the legacy backend at
 * all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagService } from "../featureFlag.service";
import type { FeatureFlagStorePostgres } from "../featureFlagStore.postgres";

const { memoryCreateSpy } = vi.hoisted(() => ({
  memoryCreateSpy: vi.fn(),
}));

vi.mock("../featureFlagService.memory", () => ({
  FeatureFlagServiceMemory: {
    create: () => {
      memoryCreateSpy();
      return {
        isEnabled: vi.fn().mockResolvedValue(false),
        isAvailable: () => true,
      };
    },
  },
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

const SYSTEM_FLAG = "ops_es_causality_loop_guard_disabled";
const PRODUCT_FLAG = "release_ui_ai_gateway_menu_enabled";
const UNREGISTERED_FLAG = "experiment_some_adhoc_unregistered_flag";

const emptyStore = {
  get: vi.fn().mockResolvedValue(null),
} as unknown as FeatureFlagStorePostgres;

function buildService() {
  // No `legacy` injected: exercises the real lazy createLegacyService path.
  return new FeatureFlagService({ store: emptyStore });
}

describe("FeatureFlagService legacy backend construction", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    // The dev .env force-enables this PRODUCT flag, which would short-circuit
    // before the legacy path. Clear the overrides so the resolver actually
    // reaches the lazily-built legacy backend.
    process.env = { ...originalEnv };
    delete process.env.RELEASE_NLP_GO_ENGINE_ENABLED;
    delete process.env.FEATURE_FLAG_FORCE_ENABLE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("given a process that only evaluates SYSTEM flags", () => {
    describe("when a SYSTEM flag is evaluated", () => {
      it("never constructs the legacy backend", async () => {
        const service = buildService();

        await service.isEnabled(SYSTEM_FLAG, {
          distinctId: "tenant-a",
          defaultValue: false,
        });

        expect(memoryCreateSpy).not.toHaveBeenCalled();
      });
    });

    describe("when constructing the service alone", () => {
      it("does not eagerly construct the legacy backend", () => {
        buildService();

        expect(memoryCreateSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a PRODUCT flag with no store override", () => {
    describe("when the flag is evaluated", () => {
      it("resolves the registry default without ever constructing the legacy backend", async () => {
        const service = buildService();

        const first = await service.isEnabled(PRODUCT_FLAG, {
          distinctId: "user-1",
          defaultValue: false,
        });
        const second = await service.isEnabled(PRODUCT_FLAG, {
          distinctId: "user-2",
          defaultValue: false,
        });

        expect(first).toBe(true);
        expect(second).toBe(true);
        expect(memoryCreateSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe("given an unregistered flag", () => {
    describe("when the flag is evaluated", () => {
      it("constructs the legacy backend on demand", async () => {
        const service = buildService();

        await service.isEnabled(UNREGISTERED_FLAG as never, {
          distinctId: "user-1",
          defaultValue: false,
        });

        expect(memoryCreateSpy).toHaveBeenCalledTimes(1);
      });

      it("constructs it only once across repeated evaluations", async () => {
        const service = buildService();

        await service.isEnabled(UNREGISTERED_FLAG as never, {
          distinctId: "user-1",
          defaultValue: false,
        });
        await service.isEnabled(UNREGISTERED_FLAG as never, {
          distinctId: "user-2",
          defaultValue: false,
        });

        expect(memoryCreateSpy).toHaveBeenCalledTimes(1);
      });
    });
  });
});
