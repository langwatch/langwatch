/**
 * @vitest-environment node
 * Which validation mode each door asks for - a choice no request schema carries.
 * @see specs/organizations/organization-members-rest-api.feature
 */
import type { TrpcProcedureFactory, TrpcProcedureRequest } from "@langwatch/api/trpc";
import { TeamNotInOrganizationError } from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";

import { inviteTrpcTransport } from "../invite.trpc.ts";
import { organizationManagementRest } from "../organization-management.rest.ts";

const ORGANIZATION_ID = "organization-1";

/** One batch, in the shape each door's own input schema parses it into. */
const REST_INPUT = {
  invites: [
    { email: "new@acme.test", role: "MEMBER", teams: [{ teamId: "team-1", role: "MEMBER" }] },
  ],
};
const TRPC_INPUT = {
  organizationId: ORGANIZATION_ID,
  invites: [
    { email: "new@acme.test", role: "MEMBER", teams: [{ teamId: "team-1", role: "MEMBER" }] },
  ],
};

/** An application that records the batch it was asked for and creates nothing. */
function recordingApp() {
  return {
    createInvitations: vi.fn<(input: unknown, by: unknown) => Promise<unknown[]>>(async () => []),
  };
}

/** Runs the management family's create-invites route over the given application. */
function answerRest(app: object, input: unknown): Promise<unknown> {
  const route = organizationManagementRest
    .router()
    .routes.find((candidate) => candidate.operation === "createOrganizationInvites");
  if (!route) throw new Error("the management family declares no createOrganizationInvites route");

  return Promise.resolve(
    route.handler(
      {
        app,
        input,
        scope: { tier: "organization", id: ORGANIZATION_ID },
        actor: { type: "user", id: "user-1" },
        signal: undefined,
      } as never,
      {} as never,
    ),
  );
}

/**
 * The procedures the namespace declares, recorded without building a tRPC
 * runtime: the mount hands the factory everything, the handler included. Named
 * the way the mount writes them, `<namespace>.<procedure>`.
 */
function trpcProcedure(dottedName: string): TrpcProcedureRequest<object> {
  const declared = new Map<string, TrpcProcedureRequest<object>>();
  const factory: TrpcProcedureFactory<object> = {
    procedure: (request) => {
      declared.set(request.procedure, request);

      return {};
    },
    router: (record) => record,
  };

  inviteTrpcTransport.router(factory, () => {
    throw new Error("the wire table never resolves an application");
  });

  const procedure = declared.get(dottedName);
  if (!procedure) throw new Error(`no procedure is declared as "${dottedName}"`);

  return procedure;
}

/**
 * Strict, as this family's published description promises: a batch naming a
 * team outside the organization is refused rather than answered 201 with
 * nothing created.
 */
describe("given the management REST door", () => {
  describe("when it creates a batch of invitations", () => {
    /** @scenario "Creating invites naming a team outside the organization is refused" */
    it("asks the application for strict validation", async () => {
      const app = recordingApp();

      await answerRest(app, REST_INPUT);

      expect(app.createInvitations.mock.calls[0]?.[0]).toMatchObject({
        organizationId: ORGANIZATION_ID,
        validation: "strict",
      });
    });

    it("lets the refusal for a team outside the organization through as it stands", async () => {
      const app = {
        createInvitations: vi.fn<() => Promise<never>>(async () => {
          throw new TeamNotInOrganizationError("team-elsewhere");
        }),
      };

      await expect(answerRest(app, REST_INPUT)).rejects.toMatchObject({
        code: "team_not_in_organization",
        httpStatus: 422,
      });
    });
  });
});

/** Lenient, as the invite form has always been: it drops what it cannot grant. */
describe("given the browser's invite form over tRPC", () => {
  describe("when it creates a batch of invitations", () => {
    /** @scenario "The invite form drops a team assignment it cannot grant" */
    it("asks the application for lenient validation, and passes the batch on unchanged", async () => {
      const app = recordingApp();

      await (
        trpcProcedure("invite.createInvites").handle as (
          args: unknown,
          ...facts: unknown[]
        ) => Promise<unknown>
      )({ app, input: TRPC_INPUT, actor: { type: "user", id: "user-1" } }, null);

      expect(app.createInvitations.mock.calls[0]?.[0]).toEqual({
        ...TRPC_INPUT,
        validation: "lenient",
      });
    });
  });
});
