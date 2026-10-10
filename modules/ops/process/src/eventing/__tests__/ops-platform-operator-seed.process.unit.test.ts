import { intentAccessorOf } from "@langwatch/eventing/testing";
/**
 * The one-time seed's marker. Spec: modules/ops/specs/platform-operator-bootstrap.feature
 */
import { describe, expect, it } from "vitest";

import {
  PLATFORM_OPERATOR_SEED_GRANT_KEY,
  PLATFORM_OPERATOR_SEED_PROCESS_NAME,
  PLATFORM_OPERATOR_SEED_TENANT_ID,
  platformOperatorSeedRecorded,
  platformOperatorSeedWake,
  type PlatformOperatorSeedState,
} from "../ops-platform-operator-seed.process.ts";

function context(at: number) {
  return {
    at,
    now: at,
    key: PLATFORM_OPERATOR_SEED_PROCESS_NAME,
    projectId: PLATFORM_OPERATOR_SEED_TENANT_ID,
    intent: intentAccessorOf({
      seed: (messageKey, payload) => ({ messageKey, intentType: "seed", payload }),
      grant: (messageKey, payload) => ({ messageKey, intentType: "grant", payload }),
    }),
  };
}

const wake = (state: PlatformOperatorSeedState, at: number) =>
  platformOperatorSeedWake(state, context(at));

const recorded = (state: PlatformOperatorSeedState, at: number) =>
  platformOperatorSeedRecorded(state, { via: "admin-emails", userIds: ["ana"] }, context(at));

describe("the platform-operator seed process", () => {
  describe("given the seed has not recorded a decision", () => {
    /** @scenario "A fresh install waits for its first user before seeding" */
    it("asks for one attempt per wake and leaves the marker unset", () => {
      const first = wake({ seededAt: null }, 1_000);
      const second = wake(first.state, 61_000);

      expect(first.state).toEqual({ seededAt: null });
      expect(first.intents?.[0]?.messageKey).toBe("seed:1000");
      expect(second.intents?.[0]?.messageKey).toBe("seed:61000");
    });
  });

  describe("given the seed recorded its decision", () => {
    /** @scenario "The seed runs once behind its marker" */
    it("sets the marker once and every later wake asks for nothing", () => {
      const latched = recorded({ seededAt: null }, 5_000).state;

      expect(latched).toEqual({ seededAt: 5_000 });
      expect(recorded(latched, 9_000).state).toEqual({ seededAt: 5_000 });
      expect(wake(latched, 65_000).intents).toBeUndefined();
    });

    /** @scenario "A seed whose decision never recorded grants nobody" */
    it("asks for the recorded users' grants once; a second record asks for nothing", () => {
      const first = recorded({ seededAt: null }, 5_000);
      const second = platformOperatorSeedRecorded(
        first.state,
        { via: "sole-organization-admin", userIds: ["someone_else"] },
        context(9_000),
      );

      expect(first.intents).toEqual([
        {
          messageKey: PLATFORM_OPERATOR_SEED_GRANT_KEY,
          intentType: "grant",
          payload: { via: "admin-emails", userIds: ["ana"] },
        },
      ]);
      expect(second.intents).toBeUndefined();
    });

    /** @scenario "With several organizations nobody is seeded and the way in is logged" */
    it("latches a nobody decision without asking for any grant", () => {
      const none = platformOperatorSeedRecorded(
        { seededAt: null },
        { via: "none", userIds: [] },
        context(5_000),
      );

      expect(none).toEqual({ state: { seededAt: 5_000 }, intents: [] });
    });
  });

  describe("given the marker is set and every holder has since been deactivated", () => {
    /** @scenario "Deactivating every holder never re-runs the seed" */
    it("asks for nothing: the wake reads only its own marker, never the holders", () => {
      expect(wake({ seededAt: 1_000 }, 9_000_000).intents).toBeUndefined();
    });
  });
});
