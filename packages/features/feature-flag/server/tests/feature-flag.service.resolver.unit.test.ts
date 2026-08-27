/**
 * Resolver coverage for the registry-driven feature flag service.
 *
 * The graph is real — service, row store and repository — with only the
 * database and the environment held in process, so these exercise the code
 * path production runs rather than a double of it.
 */
import { resolveFeatureFlagConfig } from "@langwatch/feature-flag-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryFeatureFlagService } from "../src/testing";

const SYSTEM_FLAG = "ops_es_causality_loop_guard_disabled";
const PRODUCT_FLAG = "release_ui_ai_gateway_menu_enabled";
const NON_ENV_OVERRIDABLE_FLAG = "release_langy_enabled";
const SYSTEM_TARGET = { kind: "system" } as const;
const USER_TARGET = { kind: "user", userId: "user-1" } as const;
function buildService(source: Readonly<Record<string, unknown>> = {}) {
  return createInMemoryFeatureFlagService({
    config: resolveFeatureFlagConfig(source),
  });
}

async function writeEnabled(
  service: ReturnType<typeof buildService>["service"],
  key: string,
  enabled: boolean,
): Promise<void> {
  await service.setEnabled({ key, enabled, lastEditedBy: "operator-1" });
}

describe("FeatureFlagService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a flag registered with envOverridable false", () => {
    describe("when its uppercase environment variable is set", () => {
      it("ignores the variable and resolves from the store", async () => {
        const { service } = buildService({
          [NON_ENV_OVERRIDABLE_FLAG.toUpperCase()]: "1",
        });
        await writeEnabled(service, NON_ENV_OVERRIDABLE_FLAG, false);

        const enabled = await service.isEnabled(NON_ENV_OVERRIDABLE_FLAG, USER_TARGET);

        expect(enabled).toBe(false);
      });
    });
  });

  describe("given a SYSTEM-scoped flag", () => {
    describe("when nothing overrides it", () => {
      it("resolves to the registry default", async () => {
        const { service } = buildService();

        const enabled = await service.isEnabled(SYSTEM_FLAG, SYSTEM_TARGET);

        expect(enabled).toBe(false);
      });
    });

    describe("when the store has a value", () => {
      it("uses the store value", async () => {
        const { service } = buildService();
        await writeEnabled(service, SYSTEM_FLAG, true);

        const enabled = await service.isEnabled(SYSTEM_FLAG, SYSTEM_TARGET);

        expect(enabled).toBe(true);
      });
    });

    describe("when the derived environment override is set", () => {
      it("beats the store value", async () => {
        const { service } = buildService({
          OPS_ES_CAUSALITY_LOOP_GUARD_DISABLED: "1",
        });
        await writeEnabled(service, SYSTEM_FLAG, false);

        const enabled = await service.isEnabled(SYSTEM_FLAG, SYSTEM_TARGET);

        expect(enabled).toBe(true);
      });
    });

    describe("when the legacy environment alias is set", () => {
      it("honours LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD for back-compat", async () => {
        const { service } = buildService({
          LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD: "1",
        });

        const enabled = await service.isEnabled(SYSTEM_FLAG, SYSTEM_TARGET);

        expect(enabled).toBe(true);
      });
    });
  });

  describe("given a PRODUCT-scoped flag", () => {
    describe("when no store row exists", () => {
      it("resolves to the registry default", async () => {
        const { service } = buildService();

        const enabled = await service.isEnabled(PRODUCT_FLAG, USER_TARGET);

        expect(enabled).toBe(true);
      });
    });

    describe("when an operator override row exists", () => {
      it("uses the store value", async () => {
        const { service } = buildService();
        await writeEnabled(service, PRODUCT_FLAG, true);

        const enabled = await service.isEnabled(PRODUCT_FLAG, USER_TARGET);

        expect(enabled).toBe(true);
      });
    });

    describe("when an operator disables the flag via the store", () => {
      it("returns false even when the caller's default is on", async () => {
        const { service } = buildService();
        await writeEnabled(service, PRODUCT_FLAG, false);

        const enabled = await service.isEnabled(PRODUCT_FLAG, USER_TARGET);

        expect(enabled).toBe(false);
      });
    });

    describe("when the store row carries an organization-scoped rule", () => {
      it("uses the rule for the matching organization", async () => {
        const { service } = buildService();
        await service.setRules({
          key: PRODUCT_FLAG,
          rules: [{ match: { organizationId: "org_lw" }, enabled: true }],
          lastEditedBy: "operator-1",
        });

        const enabled = await service.isEnabled(PRODUCT_FLAG, {
          kind: "organization",
          userId: "user-1",
          organizationId: "org_lw",
        });

        expect(enabled).toBe(true);
      });

      it("keeps the registry default for a non-matching organization", async () => {
        // A rules-only write seeds the new row's row-level value from the
        // registry, so an operator targeting an allowlist does not flip
        // everyone else to false.
        const { service } = buildService();
        await service.setRules({
          key: PRODUCT_FLAG,
          rules: [{ match: { organizationId: "org_lw" }, enabled: true }],
          lastEditedBy: "operator-1",
        });

        const enabled = await service.isEnabled(PRODUCT_FLAG, {
          kind: "organization",
          userId: "user-1",
          organizationId: "org_other",
        });

        expect(enabled).toBe(true);
      });
    });

    describe("when the row carries a row-level value and a non-matching rule", () => {
      it("uses the row-level value", async () => {
        const { service } = buildService();
        await writeEnabled(service, PRODUCT_FLAG, false);
        await service.setRules({
          key: PRODUCT_FLAG,
          rules: [{ match: { organizationId: "org_other" }, enabled: true }],
          lastEditedBy: "operator-1",
        });

        const enabled = await service.isEnabled(PRODUCT_FLAG, {
          kind: "organization",
          userId: "user-1",
          organizationId: "org_self",
        });

        expect(enabled).toBe(false);
      });
    });
  });

  describe("given the force-enable list names a flag", () => {
    it("returns true even though the store disables it", async () => {
      const { service } = buildService({
        FEATURE_FLAG_FORCE_ENABLE: ` other_flag , ${SYSTEM_FLAG} `,
      });
      await writeEnabled(service, SYSTEM_FLAG, false);

      const enabled = await service.isEnabled(SYSTEM_FLAG, SYSTEM_TARGET);

      expect(enabled).toBe(true);
    });
  });
});
