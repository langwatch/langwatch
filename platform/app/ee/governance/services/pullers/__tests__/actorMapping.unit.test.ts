// @vitest-environment node
// ADR-094 Decision 5. The translation from a provider's own principal-type
// vocabulary into our three buckets is declared per adapter and resolved here.

import { JSONPath } from "jsonpath-plus";
import { describe, expect, it } from "vitest";
import { resolveActorKind } from "../actorMapping";
import { CLAUDE_COMPLIANCE_PULL_CONFIG } from "../claudeCompliance.puller";
import { COPILOT_STUDIO_PULL_CONFIG } from "../copilotStudio.puller";
import { OPENAI_COMPLIANCE_PULL_CONFIG } from "../openaiCompliance.puller";

const readerFor = (event: unknown) => (path: string) =>
  JSONPath({ path, json: event as object, wrap: false }) as unknown;

const kindFrom = (
  config: { eventMapping: { actor_kind?: unknown } },
  event: unknown,
) =>
  resolveActorKind({
    mapping: config.eventMapping.actor_kind as never,
    read: readerFor(event),
  });

const actorIdFrom = (
  config: { eventMapping: { actor_id?: string } },
  event: unknown,
) => {
  const path = config.eventMapping.actor_id;
  return path === undefined ? undefined : readerFor(event)(path);
};

describe("resolveActorKind", () => {
  describe("given no mapping was declared", () => {
    it("calls the actor a person", () => {
      expect(resolveActorKind({ mapping: undefined, read: () => "6" })).toBe(
        "person",
      );
    });
  });

  describe("given a value table", () => {
    const mapping = {
      path: "$.actor.type",
      byValue: { api_key: "service_principal" as const },
    };

    it("translates a listed value", () => {
      expect(
        resolveActorKind({
          mapping,
          read: readerFor({ actor: { type: "api_key" } }),
        }),
      ).toBe("service_principal");
    });

    it("falls back to person for a value the provider added later", () => {
      expect(
        resolveActorKind({
          mapping,
          read: readerFor({ actor: { type: "workflow" } }),
        }),
      ).toBe("person");
    });

    it("falls back to person when the field is absent", () => {
      expect(resolveActorKind({ mapping, read: readerFor({}) })).toBe("person");
    });
  });

  describe("given a presence signal", () => {
    const mapping = {
      path: "$.initiatedBy.app.appId",
      byValue: {},
      whenPresent: "service_principal" as const,
    };

    it("marks the row when the field is populated", () => {
      expect(
        resolveActorKind({
          mapping,
          read: readerFor({ initiatedBy: { app: { appId: "app-1" } } }),
        }),
      ).toBe("service_principal");
    });

    it("leaves a human-initiated event a person", () => {
      expect(
        resolveActorKind({
          mapping,
          read: readerFor({ initiatedBy: { user: { id: "u-1" } } }),
        }),
      ).toBe("person");
    });

    it("treats an empty string as absent, not as a signal", () => {
      expect(
        resolveActorKind({
          mapping,
          read: readerFor({ initiatedBy: { app: { appId: "" } } }),
        }),
      ).toBe("person");
    });
  });
});

describe("the reference pullers' declared actor mappings", () => {
  describe("Microsoft", () => {
    const humanEvent = {
      initiatedBy: {
        user: {
          id: "6f8a1b2c-3d4e-4f50-9a1b-2c3d4e5f6071",
          userPrincipalName: "alice@acme.com",
        },
      },
    };

    it("joins on the immutable object id, not the renameable principal name", () => {
      // `upn` moves when a person is renamed; a report joining on a value that
      // moves attributes their past spend to nobody.
      expect(COPILOT_STUDIO_PULL_CONFIG.eventMapping.actor_id).toBe(
        "$.initiatedBy.user.id",
      );
      expect(actorIdFrom(COPILOT_STUDIO_PULL_CONFIG, humanEvent)).toBe(
        "6f8a1b2c-3d4e-4f50-9a1b-2c3d4e5f6071",
      );
    });

    it("marks an application-initiated event unattributable", () => {
      expect(
        kindFrom(COPILOT_STUDIO_PULL_CONFIG, {
          initiatedBy: { app: { appId: "app-1", displayName: "Some Bot" } },
        }),
      ).toBe("service_principal");
    });

    it("leaves a person a person", () => {
      expect(kindFrom(COPILOT_STUDIO_PULL_CONFIG, humanEvent)).toBe("person");
    });
  });

  describe("Anthropic", () => {
    it("joins on the member id rather than the email", () => {
      // Emails get recycled, and a recycled email in a money report hands the
      // previous holder's spend to whoever inherited the address.
      expect(CLAUDE_COMPLIANCE_PULL_CONFIG.eventMapping.actor_id).toBe(
        "$.actor.id",
      );
    });

    it("marks an api key and a service account unattributable", () => {
      for (const type of ["api_key", "service_account"]) {
        expect(
          kindFrom(CLAUDE_COMPLIANCE_PULL_CONFIG, { actor: { type } }),
        ).toBe("service_principal");
      }
    });

    it("leaves a member a person", () => {
      expect(
        kindFrom(CLAUDE_COMPLIANCE_PULL_CONFIG, { actor: { type: "user" } }),
      ).toBe("person");
    });
  });

  describe("OpenAI", () => {
    it("declares no join key, because it has no id namespace in the vocabulary yet", () => {
      // Feeding an id whose kind is undeclared into the join column produces a
      // value that silently matches nothing — worse than an empty one, which
      // is at least honest about being absent.
      expect(
        OPENAI_COMPLIANCE_PULL_CONFIG.eventMapping.actor_id,
      ).toBeUndefined();
    });
  });
});
