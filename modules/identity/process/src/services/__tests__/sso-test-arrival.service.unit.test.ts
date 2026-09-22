/**
 * @vitest-environment node
 * Whether the server can tell a stranded tester from a new customer: the
 * account the sign-in left behind names its connection, and that connection's
 * own state says whether it is live. Both belong to no organization.
 */
import {
  emptySsoConnection,
  type SsoConnectionLifecycleState,
  type SsoConnectionState,
} from "@langwatch/identity-contract";
import { describe, expect, it, vi } from "vitest";

import { SsoConnectionReadRepository } from "../../repositories/sso-connection.repository.ts";
import { SsoTestArrivalService } from "../sso-test-arrival.service.ts";

const CONNECTION_ID = "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m";
const ORGANIZATION = { id: "org_acme", name: "Acme" };
const USER_ID = "user_ana";
const ABANDONED: SsoConnectionLifecycleState[] = [
  "DISCARDED",
  "REJECTED",
  "SUSPENDED",
  "TORN_DOWN",
];

/** Only the one read this service makes; the other two are never reached. */
class OneConnectionReads extends SsoConnectionReadRepository {
  constructor(readonly tryFindConnection: SsoConnectionReadRepository["tryFindConnection"]) {
    super();
  }

  tryFindDomainOwner(): never {
    throw new Error("a test arrival never asks who owns a domain");
  }

  findForOrganization(): never {
    throw new Error("a test arrival never lists an organization's connections");
  }
}

function connection(over: Partial<SsoConnectionState> = {}): SsoConnectionState {
  const base = emptySsoConnection({ connectionId: CONNECTION_ID });
  return {
    ...base,
    organizationId: ORGANIZATION.id,
    state: "VERIFIED",
    verifiedDomains: ["acme.com"],
    createdBy: USER_ID,
    source: "self-serve",
    ...over,
  };
}

function serviceOver({
  providers,
  row = connection(),
  member = false,
  organization = ORGANIZATION,
}: {
  providers: readonly string[];
  row?: SsoConnectionState | null;
  member?: boolean;
  organization?: { id: string; name: string } | null;
}) {
  const tryFindConnection = vi.fn().mockResolvedValue(row);

  return {
    tryFindConnection,
    service: SsoTestArrivalService.create({
      accounts: { findAccountProvidersForUser: vi.fn().mockResolvedValue(providers) },
      connections: new OneConnectionReads(tryFindConnection),
      memberships: {
        hasAnyMembership: vi.fn().mockResolvedValue(member),
        findOrganization: vi.fn().mockResolvedValue(organization),
      },
    }),
  };
}

describe("given an account through a connection that is not live", () => {
  /** @scenario "A sign-in through a connection that is not live yet is a test arrival" */
  it("answers with the connection and the organization it belongs to", async () => {
    const { service } = serviceOver({ providers: [CONNECTION_ID] });

    await expect(service.standingFor({ userId: USER_ID })).resolves.toEqual({
      testing: true,
      connectionId: CONNECTION_ID,
      organizationId: ORGANIZATION.id,
      organizationName: ORGANIZATION.name,
    });
  });

  describe("when the person already belongs to an organization", () => {
    it("answers with nothing, because they are not stranded", async () => {
      const { service } = serviceOver({ providers: [CONNECTION_ID], member: true });

      await expect(service.standingFor({ userId: USER_ID })).resolves.toEqual({ testing: false });
    });
  });

  describe("when the organization went between the sign-in and the question", () => {
    it("answers with nothing rather than naming an organization that is gone", async () => {
      const { service } = serviceOver({ providers: [CONNECTION_ID], organization: null });

      await expect(service.standingFor({ userId: USER_ID })).resolves.toEqual({ testing: false });
    });
  });
});

describe("given an account through a connection that is live", () => {
  /** @scenario "A sign-in through a live connection is not a test arrival" */
  it("answers with nothing", async () => {
    const { service } = serviceOver({
      providers: [CONNECTION_ID],
      row: connection({ state: "ACTIVE" }),
    });

    await expect(service.standingFor({ userId: USER_ID })).resolves.toEqual({ testing: false });
  });
});

describe.each(ABANDONED)("given a %s connection", (state) => {
  /** @scenario "A connection that was abandoned strands nobody" */
  it("answers with nothing, so the ordinary way out stays open", async () => {
    const { service } = serviceOver({ providers: [CONNECTION_ID], row: connection({ state }) });

    await expect(service.standingFor({ userId: USER_ID })).resolves.toEqual({ testing: false });
  });
});

describe("given no account through any connection", () => {
  /** @scenario "The browser's own say-so is not what decides it" */
  it("answers with nothing, whatever the browser claims", async () => {
    // Nothing this service reads comes from the request, so a browser
    // asserting `?ssoTest=<id>` has nowhere to assert it.
    const { service, tryFindConnection } = serviceOver({ providers: ["credential", "google"] });

    await expect(service.standingFor({ userId: USER_ID })).resolves.toEqual({ testing: false });
    expect(tryFindConnection).not.toHaveBeenCalled();
  });
});

describe("given a connection id no row answers for", () => {
  it("answers with nothing rather than throwing", async () => {
    const { service } = serviceOver({ providers: [CONNECTION_ID], row: null });

    await expect(service.standingFor({ userId: USER_ID })).resolves.toEqual({ testing: false });
  });
});
