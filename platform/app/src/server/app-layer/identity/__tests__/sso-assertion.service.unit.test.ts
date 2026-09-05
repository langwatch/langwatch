import { describe, expect, it, vi } from "vitest";
import {
  type SignInConnection,
  SsoAssertionService,
} from "../sso-assertion.service";

/**
 * Whether an assertion from a customer's identity provider may become a
 * session — the check that runs BEFORE better-auth links it to anybody.
 *
 * The hole this pins is an account takeover, and it needs three things that
 * were all true at once: `trustEmailVerified` hands "is this address real" to
 * the customer's own identity provider; account linking joins a verified
 * address to an existing user; and a connection is dialable from DRAFT, so it
 * needs no domain proof to be reachable. Register a connection, point it at a
 * server you control, assert somebody else's address, receive their session.
 *
 * So the cases below are written as an attacker would drive them, and the
 * assertions are about the DECISION rather than about a branch: the only
 * thing that matters is whether an assertion the connection has no right to
 * make is refused.
 */

const CONNECTION_ID = "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m";

const REGISTRAR_ID = "user_ana";

const connection = (
  over: Partial<SignInConnection> = {},
): SignInConnection => ({
  organizationId: "org_acme",
  state: "ACTIVE",
  verifiedDomains: ["acme.com"],
  lapsedDomains: [],
  arrivalPolicy: "request",
  createdBy: REGISTRAR_ID,
  ...over,
});

/**
 * A directory the membership lookup is answered FROM, rather than a canned
 * row. The gate narrows that lookup by `userId`, and a fake that answers the
 * same way whatever it is asked cannot tell a colleague's address from the
 * registrar's — which is the whole subject of the cases below.
 */
const serviceOver = ({
  row,
  members = [],
}: {
  row: SignInConnection | null;
  members?: { userId: string; address: string }[];
}) => {
  const findConnectionForSignIn = vi.fn().mockResolvedValue(row);
  const findRegistrantAtAddress = vi.fn(
    async ({ userId, email }: { userId: string; email: string }) =>
      members.some(
        (candidate) =>
          candidate.userId === userId &&
          candidate.address === email.trim().toLowerCase(),
      ),
  );
  return {
    service: new SsoAssertionService({
      connections: { findConnectionForSignIn },
      memberships: { findRegistrantAtAddress },
    }),
    findConnectionForSignIn,
    findRegistrantAtAddress,
  };
};

describe("given a live connection", () => {
  describe("when it asserts an address on a domain it proved", () => {
    it("lets the sign-in through", async () => {
      const { service } = serviceOver({ row: connection() });
      expect(
        await service.decide({
          providerId: CONNECTION_ID,
          email: "ana@acme.com",
        }),
      ).toEqual({ action: "continue" });
    });

    it("folds the asserted domain the way a claimed one is folded", async () => {
      const { service } = serviceOver({ row: connection() });
      // A trailing dot and a capital are the same domain. Comparing the raw
      // tail would make both of these a refusal for a legitimate employee.
      expect(
        await service.decide({
          providerId: CONNECTION_ID,
          email: "ana@ACME.com.",
        }),
      ).toEqual({ action: "continue" });
    });

    /** ADR-123: a lapsed domain still routes, and stops provisioning. */
    it("lets somebody through on a domain whose published record has lapsed", async () => {
      const { service } = serviceOver({
        row: connection({ lapsedDomains: ["acme.com"] }),
      });
      expect(
        await service.decide({
          providerId: CONNECTION_ID,
          email: "ana@acme.com",
        }),
      ).toEqual({ action: "continue" });
    });
  });

  describe("when it asserts an address on a domain it never proved", () => {
    /** @scenario "A provider may only assert addresses on the domains it proved" */
    it("refuses, whoever the address belongs to", async () => {
      const { service } = serviceOver({ row: connection() });
      const decision = await service.decide({
        providerId: CONNECTION_ID,
        email: "ceo@victim.test",
      });
      expect(decision.action).toBe("reject");
    });

    it("refuses a subdomain of a domain it did prove", async () => {
      const { service } = serviceOver({ row: connection() });
      const decision = await service.decide({
        providerId: CONNECTION_ID,
        email: "ana@evil.acme.com",
      });
      expect(decision.action).toBe("reject");
    });

    it("never asks whether the address belongs to a member", async () => {
      const { service, findRegistrantAtAddress } = serviceOver({
        row: connection(),
      });
      await service.decide({
        providerId: CONNECTION_ID,
        email: "ceo@victim.test",
      });
      // Membership is the setup journey's exception and belongs to connections
      // that are not live yet. A live connection asserting an unproved domain
      // must not be able to reach it by asserting a member's address.
      expect(findRegistrantAtAddress).not.toHaveBeenCalled();
    });
  });
});

describe("given a connection that is not live yet", () => {
  const underSetup = (over: Partial<SignInConnection> = {}) =>
    connection({ state: "DRAFT", verifiedDomains: [], ...over });

  const directory = [
    { userId: REGISTRAR_ID, address: "ana@acme.com" },
    // A colleague in the SAME organization, who also works somewhere else.
    { userId: "user_bob", address: "bob@acme.com" },
  ];

  describe("when its own administrator signs in to test it", () => {
    it("lets them through even though no domain is proved", async () => {
      // Activation refuses without a real sign-in through the connection, so
      // this path has to exist or a connection could never be activated.
      const { service } = serviceOver({
        row: underSetup(),
        members: directory,
      });
      expect(
        await service.decide({
          providerId: CONNECTION_ID,
          email: "ana@acme.com",
        }),
      ).toEqual({ action: "continue" });
    });
  });

  describe("when it asserts a colleague's address instead of its own administrator's", () => {
    /** @scenario "A connection still being set up carries only its own people" */
    it("refuses, though the colleague is a member of the same organization", async () => {
      // The setup exemption is for ONE person: whoever registered the
      // connection. Widening it to any member hands an administrator who
      // holds `sso:manage` a colleague's session — and with it the
      // colleague's access to every other organization they belong to,
      // which the administrator never had.
      const { service } = serviceOver({
        row: underSetup(),
        members: directory,
      });
      const decision = await service.decide({
        providerId: CONNECTION_ID,
        email: "bob@acme.com",
      });
      expect(decision.action).toBe("reject");
    });

    it("narrows the membership lookup by the registrar, not just the organization", async () => {
      const { service, findRegistrantAtAddress } = serviceOver({
        row: underSetup(),
        members: directory,
      });
      await service.decide({
        providerId: CONNECTION_ID,
        email: "bob@acme.com",
      });
      expect(findRegistrantAtAddress).toHaveBeenCalledWith({
        organizationId: "org_acme",
        userId: REGISTRAR_ID,
        email: "bob@acme.com",
      });
    });
  });

  describe("when nobody is recorded as having registered it", () => {
    it("refuses, because there is no administrator to make an exception for", async () => {
      const { service, findRegistrantAtAddress } = serviceOver({
        row: underSetup({ createdBy: null }),
        members: directory,
      });
      const decision = await service.decide({
        providerId: CONNECTION_ID,
        email: "ana@acme.com",
      });
      expect(decision.action).toBe("reject");
      expect(findRegistrantAtAddress).not.toHaveBeenCalled();
    });
  });

  describe("when it asserts an address belonging to nobody in its organization", () => {
    it("refuses", async () => {
      const { service } = serviceOver({
        row: underSetup(),
        members: directory,
      });
      const decision = await service.decide({
        providerId: CONNECTION_ID,
        email: "ceo@victim.test",
      });
      expect(decision.action).toBe("reject");
    });

    it("refuses even when that address is on a domain it has claimed", async () => {
      // Claiming is not proving. A claim is a sentence the customer typed.
      const { service } = serviceOver({
        row: underSetup({ state: "CLAIMED" }),
        members: directory,
      });
      const decision = await service.decide({
        providerId: CONNECTION_ID,
        email: "ceo@victim.test",
      });
      expect(decision.action).toBe("reject");
    });
  });
});

describe("given an assertion that names no connection we hold", () => {
  describe("when it reaches the gate", () => {
    it("refuses an id that is shaped like a connection but is not one", async () => {
      const { service } = serviceOver({ row: null });
      const decision = await service.decide({
        providerId: CONNECTION_ID,
        email: "ana@acme.com",
      });
      expect(decision.action).toBe("reject");
    });

    it("refuses an id that is not a connection id at all", async () => {
      const { service, findConnectionForSignIn } = serviceOver({
        row: connection(),
      });
      const decision = await service.decide({
        providerId: "google",
        email: "ana@acme.com",
      });
      expect(decision.action).toBe("reject");
      // Cheap first, and it matters: the deployment's own brokered provider
      // does not come through this plugin, so an id that is not a connection's
      // is anomalous rather than routine.
      expect(findConnectionForSignIn).not.toHaveBeenCalled();
    });
  });
});

describe("given an address the gate cannot read a domain from", () => {
  describe("when it reaches the gate", () => {
    it.each([
      ["no address at all", null],
      ["an address with no at-sign", "anaacme.com"],
      ["an address with two at-signs", "a@b@acme.com"],
      ["an address ending at the at-sign", "ana@"],
    ])("refuses %s", async (_case, email) => {
      const { service } = serviceOver({ row: connection() });
      const decision = await service.decide({
        providerId: CONNECTION_ID,
        email,
      });
      expect(decision.action).toBe("reject");
    });
  });
});

describe("given several different reasons to refuse", () => {
  describe("when each is refused", () => {
    /** @scenario "Every refusal at the door says the same thing" */
    it("answers one code, so the refusal names no cause", async () => {
      const causes = await Promise.all([
        serviceOver({ row: null }).service.decide({
          providerId: CONNECTION_ID,
          email: "ana@acme.com",
        }),
        serviceOver({ row: connection() }).service.decide({
          providerId: CONNECTION_ID,
          email: "x@no.test",
        }),
        // No `members`, which is the default: this case is refused for the
        // connection's state, and a member list would not change the answer.
        serviceOver({ row: connection({ state: "DRAFT" }) }).service.decide({
          providerId: CONNECTION_ID,
          email: "x@acme.com",
        }),
      ]);

      const codes = new Set(
        causes.map((decision) =>
          decision.action === "reject" ? decision.code : "continued",
        ),
      );
      // An unauthenticated caller learns that they were refused and nothing
      // about which of the checks refused them.
      expect(codes).toEqual(new Set(["identity_sign_in_refused"]));
    });
  });
});
