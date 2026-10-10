/** @vitest-environment node */
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import type { OrganizationSsoConnection } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { SsoConnectionDirectoryMoveService } from "../sso-connection-directory-move.service.ts";

const replacement: OrganizationSsoConnection = {
  connectionId: "ssoc_direct",
  displayName: "Okta",
  providerId: "Okta",
  verifiedDomains: [],
  type: "oidc",
  state: "ACTIVE",
  replacesConnectionId: "ssoc_legacy",
  migrationPhase: "FINALIZED",
};

class RecordingScim implements Pick<ScimApi, "moveToConnection"> {
  readonly asked: Parameters<ScimApi["moveToConnection"]>[0][] = [];

  async moveToConnection(input: Parameters<ScimApi["moveToConnection"]>[0]): Promise<void> {
    this.asked.push(input);
  }
}

function setup(held: OrganizationSsoConnection[]) {
  const scim = new RecordingScim();
  const service = SsoConnectionDirectoryMoveService.create({
    connections: { findForOrganization: async () => held },
    scim,
  });
  return { scim, service };
}

describe("SsoConnectionDirectoryMoveService", () => {
  describe("when a move to the organization's own identity provider finishes", () => {
    /** @scenario "A finished migration asks scim to move the replaced connection's directory" */
    it("asks scim to move the replaced connection's directory onto the replacement", async () => {
      const { scim, service } = setup([replacement]);

      await service.migrationFinalized({ organizationId: "org_acme", connectionId: "ssoc_direct" });

      expect(scim.asked).toEqual([
        {
          organizationId: "org_acme",
          fromConnectionId: "ssoc_legacy",
          toConnectionId: "ssoc_direct",
        },
      ]);
    });
  });

  describe("when the finished connection replaced none", () => {
    /** @scenario "A finished connection that replaced none asks scim for nothing" */
    it("asks scim for nothing", async () => {
      const { scim, service } = setup([
        { ...replacement, replacesConnectionId: null, migrationPhase: null },
      ]);

      await service.migrationFinalized({ organizationId: "org_acme", connectionId: "ssoc_direct" });

      expect(scim.asked).toEqual([]);
    });
  });
});
