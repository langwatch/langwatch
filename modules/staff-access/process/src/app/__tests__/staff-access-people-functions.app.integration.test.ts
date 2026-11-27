/**
 * The people ops functions end to end through the staff access module, over the memory twins
 * (the function reads write only the trail; the shared Postgres lane is the main suite's).
 * Peers are stand-ins (see support/).
 * @see modules/staff-access/specs/staff-access-functions-people.feature
 */
import { ClientAddress } from "@langwatch/api/policy";
import type { StaffAccessDoorSession } from "@langwatch/staff-access-contract";
import { describe, expect, it } from "vitest";

import { MemoryStaffAccessRepositories } from "../../repositories/memory/memory.staff-access.repositories.ts";
import {
  ACME,
  AGENT_IP,
  GLOBEX,
  requestBody,
  staffAccessWorld,
  VERIFIER,
} from "./support/staff-access-world.ts";

type Scopes = Parameters<typeof requestBody>[0]["scopes"];

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

function world() {
  return staffAccessWorld({ repositories: MemoryStaffAccessRepositories.create() });
}

/** A redeemed session naming `functions`, identified by its ops token at the door. */
async function sessionFor({
  w,
  scopes,
  functions,
}: {
  w: ReturnType<typeof world>;
  scopes: Scopes;
  functions: string[];
}): Promise<StaffAccessDoorSession> {
  const agent = await w.enrol();
  const { requestId } = await w.app.createRequest({
    session: agent.session,
    body: requestBody({ scopes, functions }),
  });
  await w.approve({ choice: { requestId, spendApproved: false } });
  const answer = await w.app.redeem({ session: agent.session, requestId, codeVerifier: VERIFIER });
  const request = new Request("https://app.langwatch.test/api/staff-access/functions", {
    headers: { authorization: `Bearer ${answer.opsToken ?? ""}`, "user-agent": "langwatch-cli" },
  });
  ClientAddress.fromTrustedProxies({}).handle({ request, socketAddress: AGENT_IP });
  const caller = await Promise.resolve(w.app.staffAccessDoor.identify?.({ request }));
  return caller?.session as StaffAccessDoorSession;
}

function expectNoPersonalText(output: unknown): void {
  const text = JSON.stringify(output);
  for (const word of ["@", "Olivia Acme", "code-", "http", ACME.name, GLOBEX.name]) {
    expect(text).not.toContain(word);
  }
}

describe("the people ops functions", () => {
  describe("when a metadata session reads ACME's invitations", () => {
    /** @scenario "org.invites answers every invitation's state, role and teams" */
    it("answers each invitation's id, role, state, teams and times, and no address or code", async () => {
      const w = world();
      const session = await sessionFor({ w, scopes: ["org:metadata"], functions: ["org.invites"] });

      const { output } = await w.app.callFunction({ session, name: "org.invites", input: {} });

      expect(output).toMatchObject({ total: 3, truncated: false, nextCursor: null });
      expect((output as { items: unknown[] }).items).toEqual([
        expect.objectContaining({
          inviteId: "invite_checkout",
          state: "payment_pending",
          viaCheckout: true,
        }),
        expect.objectContaining({ inviteId: "invite_expired", role: "admin", state: "expired" }),
        {
          inviteId: "invite_pending",
          role: "member",
          state: "pending",
          billingOnly: false,
          viaCheckout: false,
          teamIds: ["team_acme"],
          requestedByUserId: "user_acme_olivia",
          acceptedByUserId: null,
          createdAt: "2026-11-01T10:00:00.000Z",
          updatedAt: "2026-11-01T10:00:00.000Z",
          expiresAt: "2026-11-03T10:00:00.000Z",
        },
      ]);
      expectNoPersonalText(output);
    });

    /** @scenario "org.invites narrows to one state and pages" */
    it("narrows to one state, and pages with a cursor that reads on", async () => {
      const w = world();
      const session = await sessionFor({ w, scopes: ["org:metadata"], functions: ["org.invites"] });
      const call = (input: Record<string, unknown>) =>
        w.app.callFunction({ session, name: "org.invites", input });

      const expired = await call({ state: "expired" });
      expect(expired.output).toMatchObject({ total: 1, items: [{ inviteId: "invite_expired" }] });

      const first = (await call({ limit: 1 })).output as {
        total: number;
        truncated: boolean;
        nextCursor: string;
      };
      expect(first).toMatchObject({ total: 3, truncated: true });
      const rest = await call({ limit: 2, cursor: first.nextCursor });
      expect(rest.output).toMatchObject({ truncated: false, nextCursor: null });
      expect(
        (rest.output as { items: { inviteId: string }[] }).items.map((item) => item.inviteId),
      ).toEqual(["invite_expired", "invite_pending"]);
    });

    /** @scenario "org.invites refuses a state it does not know" */
    it("refuses a state outside the list with staff_function_bad_input", async () => {
      const w = world();
      const session = await sessionFor({ w, scopes: ["org:metadata"], functions: ["org.invites"] });

      await expect(
        codeOf(w.app.callFunction({ session, name: "org.invites", input: { state: "lost" } })),
      ).resolves.toBe("staff_function_bad_input");
    });
  });

  describe("when an ops session looks up one account", () => {
    /** @scenario "users.find answers the account behind one exact email and its organizations" */
    it("answers the account id, creation and its active and switched-off organizations", async () => {
      const w = world();
      const session = await sessionFor({ w, scopes: ["ops:read"], functions: ["users.find"] });

      const { output } = await w.app.callFunction({
        session,
        name: "users.find",
        input: { email: "olivia@acme.test" },
      });

      expect(output).toEqual({
        items: [
          {
            userId: "user_acme_olivia",
            createdAt: "2026-01-01T00:00:00.000Z",
            deactivated: false,
            orgIds: [ACME.id],
            disabledOrgIds: [GLOBEX.id],
          },
        ],
        total: 1,
        truncated: false,
        nextCursor: null,
      });
      expectNoPersonalText(output);
    });

    /** @scenario "users.find answers an empty page for an email with no account" */
    it("answers no accounts for an address nobody holds", async () => {
      const w = world();
      const session = await sessionFor({ w, scopes: ["ops:read"], functions: ["users.find"] });

      const { output } = await w.app.callFunction({
        session,
        name: "users.find",
        input: { email: "nobody@acme.test" },
      });

      expect(output).toEqual({ items: [], total: 0, truncated: false, nextCursor: null });
    });

    /** @scenario "users.find is not reachable from an organization session" */
    it("refuses users.find on an org:metadata request", async () => {
      const w = world();
      const agent = await w.enrol();

      await expect(
        codeOf(
          w.app.createRequest({
            session: agent.session,
            body: requestBody({ scopes: ["org:metadata"], functions: ["users.find"] }),
          }),
        ),
      ).resolves.toBe("staff_function_scope_mismatch");
    });
  });

  describe("when a metadata session reads ACME's members", () => {
    /** @scenario "org.members answers role, how they joined, last sign-in and switched-off state" */
    it("answers each member's role, provenance, last sign-in and state, with no name or address", async () => {
      const w = world();
      const session = await sessionFor({ w, scopes: ["org:metadata"], functions: ["org.members"] });

      const { output } = await w.app.callFunction({ session, name: "org.members", input: {} });

      expect(output).toEqual({
        items: [
          {
            userId: "user_acme_ben",
            role: "member",
            invited: true,
            joinedAt: "2026-02-01T00:00:00.000Z",
            disabledAt: "2026-02-01T00:00:00.000Z",
            lastSignInAt: null,
            deactivated: false,
          },
          {
            userId: "user_acme_lee",
            role: "other",
            invited: false,
            joinedAt: "2026-02-01T00:00:00.000Z",
            disabledAt: null,
            lastSignInAt: null,
            deactivated: true,
          },
          {
            userId: "user_acme_olivia",
            role: "admin",
            invited: false,
            joinedAt: "2026-02-01T00:00:00.000Z",
            disabledAt: null,
            lastSignInAt: "2026-11-01T07:00:00.000Z",
            deactivated: false,
          },
        ],
        total: 3,
        truncated: false,
        nextCursor: null,
      });
      expectNoPersonalText(output);
    });
  });

  describe("when an ops session asks which organizations are over their seats", () => {
    /** @scenario "orgs.seat_overage lists only the organizations over their seat cap" */
    it("answers ACME alone, with its plan, caps, seats used and how far over", async () => {
      const w = world();
      const session = await sessionFor({
        w,
        scopes: ["ops:read"],
        functions: ["orgs.seat_overage"],
      });

      const { output } = await w.app.callFunction({
        session,
        name: "orgs.seat_overage",
        input: {},
      });

      expect(output).toEqual({
        items: [
          {
            organizationId: ACME.id,
            plan: "GROWTH_SEAT_EUR_MONTHLY",
            fullSeatCap: 10,
            fullSeatsUsed: 12,
            liteSeatCap: 2,
            liteSeatsUsed: 3,
            overBy: 3,
            overPlanSince: "2026-10-15T00:00:00.000Z",
          },
        ],
        total: 1,
        truncated: false,
        nextCursor: null,
      });
      expectNoPersonalText(output);
    });

    /** @scenario "orgs.seat_overage is not reachable from an organization session" */
    it("refuses orgs.seat_overage on an org:metadata request", async () => {
      const w = world();
      const agent = await w.enrol();

      await expect(
        codeOf(
          w.app.createRequest({
            session: agent.session,
            body: requestBody({ scopes: ["org:metadata"], functions: ["orgs.seat_overage"] }),
          }),
        ),
      ).resolves.toBe("staff_function_scope_mismatch");
    });
  });
});
