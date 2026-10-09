// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  emptySsoConnection,
  type SsoConnectionState,
} from "@langwatch/identity";
import { describe, expect, it } from "vitest";
import { SsoConnectionGuards } from "../sso-connection-guards";
import {
  InMemoryConnections,
  StubBreakGlassBindings,
  StubLicenseAuthority,
  StubPlatformOperators,
  StubStranding,
} from "./support/in-memory-connections";

/**
 * When a rename is a fact, and when it is nothing happening.
 *
 * The verb is allowed in states where every other change is refused, and that
 * is the rule worth pinning: the others each decide who gets in, so they are
 * narrow on purpose; this one decides nothing, so refusing it would only
 * leave somebody looking at a name they cannot correct.
 */

const ORG = "org_acme";
const CONNECTION_ID = "ssoconn_acme";
const T0 = 1_756_000_000_000;

const seeded = ({
  state,
  name,
}: {
  state: SsoConnectionState["state"];
  name: string;
}) => {
  const connections = new InMemoryConnections();
  const base = emptySsoConnection({ connectionId: CONNECTION_ID });
  connections.seed({
    ...base,
    organizationId: ORG,
    state,
    idpMetadata: { ...base.idpMetadata, providerId: name },
  });
  return {
    connections,
    guards: new SsoConnectionGuards({
      connections,
      registrationSlots: connections,
      breakGlass: new StubBreakGlassBindings(false),
      stranding: new StubStranding(),
      platformOperators: new StubPlatformOperators(),
      licenseAuthority: new StubLicenseAuthority(),
    }),
  };
};

const command = (name: string) => ({
  tenantId: ORG,
  organizationId: ORG,
  connectionId: CONNECTION_ID,
  commandId: "cmd_rename_1",
  occurredAtMs: T0,
  actor: { type: "user" as const, id: "user_ana" },
  source: "self-serve" as const,
  name,
});

describe("renaming a connection", () => {
  describe("given a name different from the one it has", () => {
    it("states the rename", async () => {
      const { guards } = seeded({ state: "ACTIVE", name: "lw" });

      const facts = await guards.renameConnection(command("Acme Okta"));

      expect(facts).toHaveLength(1);
      expect(facts[0]?.data).toMatchObject({ name: "Acme Okta" });
    });
  });

  describe("given the name it already has", () => {
    /** @scenario "Renaming it to what it is already called is not an event" */
    it("records nothing", async () => {
      const { guards } = seeded({ state: "ACTIVE", name: "lw" });

      // Trimmed before comparing, so re-saving the same word with a stray
      // space is still nothing happening.
      await expect(guards.renameConnection(command("  lw  "))).resolves.toEqual(
        [],
      );
    });
  });

  describe("given a connection that is not live yet", () => {
    /** @scenario "A connection can be renamed while it is still being set up" */
    it("is renamed anyway, because a name decides nothing", async () => {
      const { guards } = seeded({ state: "VERIFIED", name: "lw" });

      const facts = await guards.renameConnection(command("Acme Okta"));

      expect(facts).toHaveLength(1);
    });
  });
});
