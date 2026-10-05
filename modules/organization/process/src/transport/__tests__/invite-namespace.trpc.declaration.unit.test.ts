/**
 * @vitest-environment node
 * Which namespace each invitation procedure is declared under.
 * @see specs/identity/resilient-invitations.feature
 */
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import { describe, expect, it } from "vitest";

import { inviteTrpcTransport } from "../invite.trpc.ts";
import { organizationTrpcTransport } from "../organization.trpc.ts";

const notCalled = (): never => {
  throw new Error("the application is not reached while declaring");
};

/** Every procedure a router declares, by its full `namespace.name`. */
function declared(mount: (runtime: TrpcProcedureFactory<object>) => unknown): readonly string[] {
  const names: string[] = [];
  mount({
    procedure: ({ procedure }) => {
      names.push(procedure);
      return {};
    },
    router: (record) => record,
  });
  return names;
}

const invite = declared((runtime) => inviteTrpcTransport.router(runtime, notCalled));
const organization = declared((runtime) => organizationTrpcTransport.router(runtime, notCalled));

const INVITATION_OPERATIONS = [
  "invite.createInvites",
  "invite.deleteInvite",
  "invite.resendInvite",
  "invite.getOrganizationPendingInvites",
  "invite.acceptInvite",
] as const;

describe("given a client discovering the invitation procedures", () => {
  describe("when the declared procedures are listed", () => {
    /** @scenario "Invitation RPCs have one dedicated namespace" */
    it("finds create, revoke, resend, list and accept under invite and none under organization", () => {
      expect(invite).toEqual(expect.arrayContaining([...INVITATION_OPERATIONS]));
      expect(invite.every((name) => name.startsWith("invite."))).toBe(true);

      const organizationNames = organization.map((name) => name.split(".")[1]);
      for (const operation of INVITATION_OPERATIONS) {
        expect(organizationNames).not.toContain(operation.split(".")[1]);
      }
    });

    /** @scenario "Invitation RPCs have one dedicated namespace" */
    it("does not restore the retired approval-request procedures", () => {
      for (const name of [...invite, ...organization]) {
        expect(name).not.toMatch(/approv|inviteRequest/i);
      }
    });
  });
});
