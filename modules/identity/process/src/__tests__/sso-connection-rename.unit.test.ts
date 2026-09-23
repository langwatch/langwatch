/**
 * @vitest-environment node
 * A rename decides nothing about who gets in, so it is allowed where every
 * other change is refused. @see specs/identity/sso-connection-lifecycle.feature
 */
import { emptySsoConnection, type SsoConnectionState } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { SsoConnectionGuardsService } from "../services/sso-connection-guards.service.ts";
import {
  InMemoryConnections,
  StubBreakGlassBindings,
  StubPlatformOperators,
  StubStranding,
} from "./support/in-memory-connections.ts";

const ORG = "org_acme";
const CONNECTION_ID = "local_ssoc_rename00000000000000000000";
const T0 = 1_756_000_000_000;

function guardsOver({ state, name }: { state: SsoConnectionState["state"]; name: string }) {
  const connections = new InMemoryConnections();
  const base = emptySsoConnection({ connectionId: CONNECTION_ID });
  connections.seed({
    ...base,
    organizationId: ORG,
    state,
    idpMetadata: { ...base.idpMetadata, providerId: name },
  });

  return SsoConnectionGuardsService.create({
    connections,
    registrationSlots: connections,
    breakGlass: new StubBreakGlassBindings(false),
    stranding: new StubStranding(),
    platformOperators: new StubPlatformOperators(),
  });
}

function rename(name: string) {
  return {
    tenantId: ORG,
    organizationId: ORG,
    connectionId: CONNECTION_ID,
    commandId: "cmd_rename_1",
    occurredAtMs: T0,
    actor: { type: "user" as const, id: "user_ana" },
    source: "self-serve" as const,
    name,
  };
}

describe("renaming a connection", () => {
  describe("given a name different from the one it has", () => {
    it("states the rename", async () => {
      const facts = await guardsOver({ state: "ACTIVE", name: "lw" }).renameConnection(
        rename("Acme Okta"),
      );

      expect(facts).toHaveLength(1);
      expect(facts[0]?.data).toMatchObject({ name: "Acme Okta" });
    });
  });

  describe("given the name it already has", () => {
    /** @scenario "Renaming it to what it is already called is not an event" */
    it("records nothing, even with stray spaces around it", async () => {
      await expect(
        guardsOver({ state: "ACTIVE", name: "lw" }).renameConnection(rename("  lw  ")),
      ).resolves.toEqual([]);
    });
  });

  describe("given a connection that is not live yet", () => {
    /** @scenario "A connection can be renamed while it is still being set up" */
    it("is renamed anyway, because a name decides nothing", async () => {
      const facts = await guardsOver({ state: "VERIFIED", name: "lw" }).renameConnection(
        rename("Acme Okta"),
      );

      expect(facts).toHaveLength(1);
    });
  });
});
