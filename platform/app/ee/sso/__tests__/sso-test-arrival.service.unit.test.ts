import { describe, expect, it, vi } from "vitest";
import type { SignInConnection } from "../sso-assertion.service";
import { SsoTestArrivalService } from "../sso-test-arrival.service";

/**
 * Whether the server can tell a stranded tester from a new customer.
 *
 * The distinction is the whole feature: both hold a session and belong to no
 * organization, and the product used to offer both the screen that creates
 * one. What separates them is the account the sign-in left behind — it names
 * the connection — and that connection's own state.
 *
 * Every case asserts the ANSWER rather than which read happened, because the
 * answer is what the landing and the organization guard both act on.
 */

const CONNECTION_ID = "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m";
const ORG = { id: "org_acme", name: "Acme" };
const USER_ID = "user_ana";
const inactiveStates: SignInConnection["state"][] = [
  "DISCARDED",
  "REJECTED",
  "SUSPENDED",
  "TORN_DOWN",
];

const connection = (
  over: Partial<SignInConnection> = {},
): SignInConnection => ({
  organizationId: ORG.id,
  state: "VERIFIED",
  arrivalPolicy: "admit",
  verifiedDomains: ["acme.com"],
  domainVerifications: [],
  lapsedDomains: [],
  createdBy: USER_ID,
  source: "self-serve",
  providerId: "okta",
  ...over,
});

const serviceOver = ({
  providers,
  row = connection(),
  member = false,
  organization = ORG,
}: {
  providers: readonly string[];
  row?: SignInConnection | null;
  /** Whether this person belongs to any organization at all. */
  member?: boolean;
  organization?: { id: string; name: string } | null;
}) => {
  const findConnectionForSignIn = vi.fn().mockResolvedValue(row);
  const hasAnyMembership = vi.fn().mockResolvedValue(member);
  return {
    findConnectionForSignIn,
    hasAnyMembership,
    service: new SsoTestArrivalService({
      accounts: {
        findAccountProvidersForUser: vi.fn().mockResolvedValue(providers),
      },
      connections: { findConnectionForSignIn },
      memberships: {
        hasAnyMembership,
        findOrganizationForMembership: vi.fn().mockResolvedValue(organization),
      },
    }),
  };
};

describe("SsoTestArrivalService", () => {
  describe("given an account through a connection that is not live", () => {
    /** @scenario "A sign-in through a connection that is not live yet is a test arrival" */
    it("answers with the connection and the organization it belongs to", async () => {
      const { service } = serviceOver({ providers: [CONNECTION_ID] });

      await expect(service.standingFor({ userId: USER_ID })).resolves.toEqual({
        connectionId: CONNECTION_ID,
        organizationId: ORG.id,
        organizationName: ORG.name,
      });
    });

    describe("when the person already belongs to an organization", () => {
      it("answers with nothing, because they are not stranded", async () => {
        const { service } = serviceOver({
          providers: [CONNECTION_ID],
          member: true,
        });

        await expect(
          service.standingFor({ userId: USER_ID }),
        ).resolves.toBeNull();
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

      await expect(
        service.standingFor({ userId: USER_ID }),
      ).resolves.toBeNull();
    });
  });

  describe.each(inactiveStates)("given a %s connection", (state) => {
    /** @scenario "A connection that was abandoned strands nobody" */
    it("answers with nothing, so the ordinary way out stays open", async () => {
      const { service } = serviceOver({
        providers: [CONNECTION_ID],
        row: connection({ state }),
      });

      await expect(
        service.standingFor({ userId: USER_ID }),
      ).resolves.toBeNull();
    });
  });

  describe("given no account through any connection", () => {
    /** @scenario "The browser's own say-so is not what decides it" */
    it("answers with nothing, whatever the browser claims", async () => {
      // The ordinary sign-in methods, none of which is a connection. Nothing
      // this service reads comes from the request, so a browser asserting
      // `?ssoTest=<id>` has nowhere to assert it.
      const { service, findConnectionForSignIn } = serviceOver({
        providers: ["credential", "google"],
      });

      await expect(
        service.standingFor({ userId: USER_ID }),
      ).resolves.toBeNull();
      expect(findConnectionForSignIn).not.toHaveBeenCalled();
    });
  });

  describe("given a connection id no row answers for", () => {
    it("answers with nothing rather than throwing", async () => {
      const { service } = serviceOver({
        providers: [CONNECTION_ID],
        row: null,
      });

      await expect(
        service.standingFor({ userId: USER_ID }),
      ).resolves.toBeNull();
    });
  });
});
