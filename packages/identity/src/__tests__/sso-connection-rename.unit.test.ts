import { describe, expect, it } from "vitest";
import {
  CONNECTION_RENAMED_EVENT_TYPE,
  connectionRenamedPayloadSchema,
  emptySsoConnection,
  reduceSsoConnection,
  renameConnectionCommandDataSchema,
  type SsoConnectionFact,
} from "../index";

/**
 * What a rename leaves on the connection, and what it leaves alone.
 *
 * The second half is the point. A sign-in reaches a connection by its
 * CONNECTION ID — the engine's provider row is keyed on it deliberately, so
 * two organizations can both call theirs `okta` — so the name is a label and
 * renaming must move nothing else. Asserted rather than assumed, because the
 * field it folds onto sits inside the identity provider's own metadata beside
 * values that DO decide sign-ins.
 */

const T0 = 1_756_000_000_000;
const CONNECTION_ID = "ssoconn_acme";

const renamed = (name: string): SsoConnectionFact =>
  ({
    type: CONNECTION_RENAMED_EVENT_TYPE,
    occurredAt: T0,
    data: {
      connectionId: CONNECTION_ID,
      name,
      actor: { type: "user", id: "user_ana" },
      source: "self-serve",
    },
  }) as SsoConnectionFact;

const blank = () => emptySsoConnection({ connectionId: CONNECTION_ID });

describe("given an administrator renaming a connection", () => {
  describe("when the new name is folded in", () => {
    /** @scenario "Renaming a connection changes the name and nothing else" */
    it("answers to the new name, keeping its identifier and who it admits", () => {
      const before = blank();
      const after = reduceSsoConnection({
        state: before,
        fact: renamed("Acme Okta"),
      });

      expect(after.idpMetadata.providerId).toBe("Acme Okta");
      // The two facts a rename must not touch: what a sign-in dials, and who
      // gets in when it arrives.
      expect(after.connectionId).toBe(before.connectionId);
      expect(after.arrivalPolicy).toBe(before.arrivalPolicy);
      // Nor anything else the identity provider's metadata carries.
      expect(after.idpMetadata.issuer).toBe(before.idpMetadata.issuer);
      expect(after.idpMetadata.clientIdRef).toBe(before.idpMetadata.clientIdRef);
      expect(after.state).toBe(before.state);
    });
  });

  describe("when the name is blank or only spaces", () => {
    /** @scenario "A name is required" */
    it("is refused before it can become a command", () => {
      expect(
        renameConnectionCommandDataSchema.safeParse({
          connectionId: CONNECTION_ID,
          organizationId: "org_acme",
          commandId: "cmd_1",
          occurredAtMs: T0,
          actor: { type: "user", id: "user_ana" },
          source: "self-serve",
          name: "   ",
        }).success,
      ).toBe(false);

      expect(
        connectionRenamedPayloadSchema.safeParse({
          connectionId: CONNECTION_ID,
          name: "",
          actor: { type: "user", id: "user_ana" },
          source: "self-serve",
        }).success,
      ).toBe(false);
    });
  });
});
