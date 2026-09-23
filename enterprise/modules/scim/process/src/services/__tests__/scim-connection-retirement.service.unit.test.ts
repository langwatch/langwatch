// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * What a provisioning token may still reach: the connection it was issued
 * against, for exactly as long as the organization holds it.
 */
import type { OrganizationSsoConnection } from "@langwatch/identity-contract";
import { describe, expect, it, vi } from "vitest";

import { ScimConnectionRetirementService } from "../scim-connection-retirement.service.ts";

const ORGANIZATION_ID = "org_acme";
const CONNECTION_ID = "ssoc_okta";

function connection(state: string, connectionId = CONNECTION_ID): OrganizationSsoConnection {
  return {
    connectionId,
    displayName: "Okta",
    providerId: "Okta",
    verifiedDomains: [],
    type: "oidc",
    state: state as OrganizationSsoConnection["state"],
  };
}

function retirement(held: OrganizationSsoConnection[]) {
  const revokeTokensForConnection = vi.fn(async () => ({ revoked: 2 }));
  const service = ScimConnectionRetirementService.create({
    connections: { findConnections: async () => held },
    tokens: { revokeTokensForConnection },
  });

  return {
    revokeTokensForConnection,
    admits: () => service.admits({ organizationId: ORGANIZATION_ID, connectionId: CONNECTION_ID }),
  };
}

describe("given a connection the organization still holds", () => {
  it("admits the credential and retires nothing", async () => {
    const live = retirement([connection("ACTIVE")]);

    await expect(live.admits()).resolves.toBe(true);
    expect(live.revokeTokensForConnection).not.toHaveBeenCalled();
  });

  /** @scenario "A suspended connection keeps the tokens issued against it" */
  it("admits it while the connection is only suspended, which is paused rather than gone", async () => {
    const paused = retirement([connection("SUSPENDED")]);

    await expect(paused.admits()).resolves.toBe(true);
    expect(paused.revokeTokensForConnection).not.toHaveBeenCalled();
  });

  it("refuses it while a teardown is pending, as main did, but keeps its tokens", async () => {
    const leaving = retirement([connection("TEARDOWN_PENDING")]);

    await expect(leaving.admits()).resolves.toBe(false);
    expect(leaving.revokeTokensForConnection).not.toHaveBeenCalled();
  });

  it("admits a connection whose domain claim was rejected, as main did", async () => {
    const rejected = retirement([connection("REJECTED")]);

    await expect(rejected.admits()).resolves.toBe(true);
    expect(rejected.revokeTokensForConnection).not.toHaveBeenCalled();
  });
});

describe("given a connection the organization has taken away", () => {
  /** @scenario "Removing a connection ends the tokens issued against it" */
  /** @scenario "A token whose connection was taken away is refused and retired" */
  it("refuses the credential and retires every token issued against it", async () => {
    const gone = retirement([connection("TORN_DOWN")]);

    await expect(gone.admits()).resolves.toBe(false);
    expect(gone.revokeTokensForConnection).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      connectionId: CONNECTION_ID,
    });
  });

  it("refuses a connection discarded before it ever went live", async () => {
    const discarded = retirement([connection("DISCARDED")]);

    await expect(discarded.admits()).resolves.toBe(false);
    expect(discarded.revokeTokensForConnection).toHaveBeenCalledOnce();
  });

  // A token naming a connection identity does not answer for is not a token
  // whose connection "might come back": nothing in this organization reaches
  // it, so admitting it would be provisioning into nobody's directory.
  it("refuses a connection identity no longer answers for at all", async () => {
    const unknown = retirement([connection("ACTIVE", "ssoc_somebody_else")]);

    await expect(unknown.admits()).resolves.toBe(false);
    expect(unknown.revokeTokensForConnection).toHaveBeenCalledOnce();
  });
});
