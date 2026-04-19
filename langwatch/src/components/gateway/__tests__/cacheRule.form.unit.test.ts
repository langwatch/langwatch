import { describe, expect, it } from "vitest";

import {
  emptyFormState,
  fromWire,
  toWire,
  validateForm,
  type CacheRuleFormState,
} from "../cacheRule.form";

function buildState(
  overrides: Partial<CacheRuleFormState> = {},
): CacheRuleFormState {
  return { ...emptyFormState(), ...overrides };
}

describe("cacheRule.form", () => {
  describe("emptyFormState", () => {
    it("defaults to respect mode + priority 100 + enabled true", () => {
      const s = emptyFormState();
      expect(s.actionMode).toBe("respect");
      expect(s.priority).toBe(100);
      expect(s.enabled).toBe(true);
    });
  });

  describe("validateForm", () => {
    describe("when name is empty", () => {
      it("rejects", () => {
        expect(
          validateForm(
            buildState({ matchVkId: "vk_01", name: "   " }),
          ),
        ).toMatch(/Name is required/);
      });
    });

    describe("when priority is out of bounds", () => {
      it("rejects negative priority", () => {
        expect(
          validateForm(
            buildState({
              name: "x",
              priority: -1,
              matchVkId: "vk_01",
            }),
          ),
        ).toMatch(/Priority must be between 0 and 1000/);
      });

      it("rejects priority above 1000", () => {
        expect(
          validateForm(
            buildState({
              name: "x",
              priority: 1001,
              matchVkId: "vk_01",
            }),
          ),
        ).toMatch(/Priority must be between 0 and 1000/);
      });
    });

    describe("when TTL is provided on force mode", () => {
      it("rejects negative TTL", () => {
        expect(
          validateForm(
            buildState({
              name: "x",
              matchVkId: "vk_01",
              actionMode: "force",
              actionTtlSeconds: "-5",
            }),
          ),
        ).toMatch(/TTL must be a number/);
      });

      it("rejects TTL above 86400", () => {
        expect(
          validateForm(
            buildState({
              name: "x",
              matchVkId: "vk_01",
              actionMode: "force",
              actionTtlSeconds: "100000",
            }),
          ),
        ).toMatch(/TTL must be a number/);
      });

      it("rejects non-numeric TTL", () => {
        expect(
          validateForm(
            buildState({
              name: "x",
              matchVkId: "vk_01",
              actionMode: "force",
              actionTtlSeconds: "forever",
            }),
          ),
        ).toMatch(/TTL must be a number/);
      });

      it("accepts TTL at lower bound 0", () => {
        expect(
          validateForm(
            buildState({
              name: "x",
              matchVkId: "vk_01",
              actionMode: "force",
              actionTtlSeconds: "0",
            }),
          ),
        ).toBeNull();
      });

      it("accepts TTL at upper bound 86400", () => {
        expect(
          validateForm(
            buildState({
              name: "x",
              matchVkId: "vk_01",
              actionMode: "force",
              actionTtlSeconds: "86400",
            }),
          ),
        ).toBeNull();
      });
    });

    describe("when TTL is given on a non-force mode", () => {
      it("accepts (TTL is ignored outside force mode)", () => {
        expect(
          validateForm(
            buildState({
              name: "x",
              matchVkId: "vk_01",
              actionMode: "disable",
              actionTtlSeconds: "-5",
            }),
          ),
        ).toBeNull();
      });
    });

    describe("when request metadata is half-specified", () => {
      it("rejects key without value", () => {
        expect(
          validateForm(
            buildState({
              name: "x",
              matchMetadataKey: "X-Tier",
              matchMetadataValue: "",
            }),
          ),
        ).toMatch(/Request metadata needs both a key and a value/);
      });

      it("rejects value without key", () => {
        expect(
          validateForm(
            buildState({
              name: "x",
              matchMetadataKey: "",
              matchMetadataValue: "enterprise",
            }),
          ),
        ).toMatch(/Request metadata needs both a key and a value/);
      });
    });

    describe("when no matcher is specified", () => {
      it("rejects (match-every-request not supported in v1)", () => {
        expect(validateForm(buildState({ name: "x" }))).toMatch(
          /At least one matcher is required/,
        );
      });
    });

    describe("when at least one matcher is set", () => {
      it("accepts vk_id alone", () => {
        expect(
          validateForm(buildState({ name: "x", matchVkId: "vk_01" })),
        ).toBeNull();
      });

      it("accepts vk_prefix alone", () => {
        expect(
          validateForm(
            buildState({ name: "x", matchVkPrefix: "lw_vk_live_" }),
          ),
        ).toBeNull();
      });

      it("accepts vk_tags CSV alone", () => {
        expect(
          validateForm(
            buildState({ name: "x", matchVkTagsCsv: "tier=enterprise" }),
          ),
        ).toBeNull();
      });

      it("accepts principal_id alone", () => {
        expect(
          validateForm(
            buildState({ name: "x", matchPrincipalId: "user_01" }),
          ),
        ).toBeNull();
      });

      it("accepts model alone", () => {
        expect(
          validateForm(buildState({ name: "x", matchModel: "gpt-5-mini" })),
        ).toBeNull();
      });

      it("accepts full metadata key+value", () => {
        expect(
          validateForm(
            buildState({
              name: "x",
              matchMetadataKey: "X-Tier",
              matchMetadataValue: "enterprise",
            }),
          ),
        ).toBeNull();
      });
    });
  });

  describe("toWire", () => {
    it("strips empty matcher fields + parses the CSV tags", () => {
      const wire = toWire(
        buildState({
          name: "  trimmed  ",
          description: "",
          priority: 250,
          enabled: true,
          matchVkId: "",
          matchVkPrefix: "  ",
          matchVkTagsCsv: "tier=enterprise, team=ml ,",
          matchPrincipalId: "",
          matchModel: "",
          matchMetadataKey: "",
          matchMetadataValue: "",
          actionMode: "force",
          actionTtlSeconds: "",
          actionSalt: "",
        }),
      );
      expect(wire.name).toBe("trimmed");
      expect(wire.description).toBeNull();
      expect(wire.priority).toBe(250);
      expect(wire.matchers).toEqual({ vk_tags: ["tier=enterprise", "team=ml"] });
      expect(wire.action).toEqual({ mode: "force" });
    });

    it("includes ttl only when action mode is force AND ttl is non-empty", () => {
      const wire = toWire(
        buildState({
          name: "x",
          matchVkId: "vk_01",
          actionMode: "force",
          actionTtlSeconds: "600",
        }),
      );
      expect(wire.action).toEqual({ mode: "force", ttl: 600 });
    });

    it("omits ttl when mode is non-force (even if user typed in the field)", () => {
      const wire = toWire(
        buildState({
          name: "x",
          matchVkId: "vk_01",
          actionMode: "disable",
          actionTtlSeconds: "600",
        }),
      );
      expect(wire.action).toEqual({ mode: "disable" });
    });

    it("includes salt when non-empty", () => {
      const wire = toWire(
        buildState({
          name: "x",
          matchVkId: "vk_01",
          actionSalt: "2026Q1-rerun",
        }),
      );
      expect(wire.action).toEqual({ mode: "respect", salt: "2026Q1-rerun" });
    });

    it("packs request_metadata as a single-key record from key+value pair", () => {
      const wire = toWire(
        buildState({
          name: "x",
          matchMetadataKey: "X-Tier",
          matchMetadataValue: "enterprise",
        }),
      );
      expect(wire.matchers).toEqual({
        request_metadata: { "X-Tier": "enterprise" },
      });
    });
  });

  describe("fromWire", () => {
    it("round-trips a rule with vk_tags + ttl through UI state", () => {
      const state = fromWire({
        name: "enterprise-force",
        description: "force cache for enterprise tagged VKs",
        priority: 300,
        enabled: true,
        matchers: { vk_tags: ["tier=enterprise", "team=ml"] },
        action: { mode: "force", ttl: 600 },
      });
      expect(state.name).toBe("enterprise-force");
      expect(state.priority).toBe(300);
      expect(state.matchVkTagsCsv).toBe("tier=enterprise,team=ml");
      expect(state.actionMode).toBe("force");
      expect(state.actionTtlSeconds).toBe("600");
    });

    it("picks up the first metadata key/value pair and leaves others", () => {
      const state = fromWire({
        name: "meta-rule",
        description: null,
        priority: 100,
        enabled: true,
        matchers: {
          request_metadata: { "X-Tier": "enterprise", "X-Region": "eu" },
        },
        action: { mode: "disable" },
      });
      // UI only edits one pair at a time; the rest remain in the stored JSON
      // but aren't surfaced in form state.
      expect(state.matchMetadataKey).toBe("X-Tier");
      expect(state.matchMetadataValue).toBe("enterprise");
    });

    it("defaults to respect when the stored mode is unrecognised", () => {
      const state = fromWire({
        name: "legacy",
        description: null,
        priority: 0,
        enabled: true,
        matchers: { vk_id: "vk_01" },
        action: { mode: "legacy-unknown" as unknown as "force" },
      });
      expect(state.actionMode).toBe("respect");
    });

    it("handles missing matchers + action (migrations / nulls)", () => {
      const state = fromWire({
        name: "bare",
        description: null,
        priority: 100,
        enabled: false,
        matchers: undefined as unknown,
        action: undefined as unknown,
      });
      expect(state.matchVkId).toBe("");
      expect(state.matchVkTagsCsv).toBe("");
      expect(state.actionMode).toBe("respect");
      expect(state.actionTtlSeconds).toBe("");
    });
  });

  describe("toWire ∘ fromWire round-trip", () => {
    it("preserves matcher + action shape for a realistic enterprise rule", () => {
      const original = {
        name: "enterprise-force",
        description: "force cache for enterprise VKs",
        priority: 300,
        enabled: true,
        matchers: { vk_tags: ["tier=enterprise"] },
        action: { mode: "force" as const, ttl: 600 },
      };
      const state = fromWire(original);
      const wire = toWire(state);
      expect(wire.name).toBe(original.name);
      expect(wire.description).toBe(original.description);
      expect(wire.priority).toBe(original.priority);
      expect(wire.enabled).toBe(original.enabled);
      expect(wire.matchers).toEqual(original.matchers);
      expect(wire.action).toEqual(original.action);
    });
  });
});
