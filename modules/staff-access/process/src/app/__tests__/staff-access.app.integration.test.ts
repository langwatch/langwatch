/**
 * Staff access end to end through its module, against Postgres when `LANGWATCH_TEST_DATABASE_URL`
 * names one and against the memory twins always. Peers are stand-ins (see support/).
 * @see modules/staff-access/specs/staff-access-approval.feature
 * @see modules/staff-access/specs/staff-access-use.feature
 */
import { ClientAddress } from "@langwatch/api/policy";
import type { RestStaffAccessRequest } from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import {
  staffAccessRequestBodySchema,
  type StaffAccessDoorSession,
} from "@langwatch/staff-access-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MemoryStaffAccessEventRepository } from "../../repositories/memory/memory.staff-access-event.repository.ts";
import { MemoryStaffAccessRepositories } from "../../repositories/memory/memory.staff-access.repositories.ts";
import { PostgresStaffAccessRepositories } from "../../repositories/prisma/prisma.staff-access.repositories.ts";
import type { StaffAccessRepositories } from "../../repositories/staff-access.repositories.ts";
import {
  ACME,
  AGENT_IP,
  assertionOver,
  OLIVIA,
  PEDRO,
  requestBody,
  staffAccessWorld,
  VERIFIER,
} from "./support/staff-access-world.ts";

type Backend = Readonly<{ name: string; repositories: () => StaffAccessRepositories }>;

/** The code a promise rejects with, for asserting on codes rather than prose. */
async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

function requestFrom({ bearer, ip = AGENT_IP }: { bearer: string; ip?: string }): Request {
  const request = new Request("https://app.langwatch.test/api/staff-access/requests", {
    headers: { authorization: `Bearer ${bearer}`, "user-agent": "langwatch-cli" },
  });
  ClientAddress.fromTrustedProxies({}).handle({ request, socketAddress: ip });
  return request;
}

function gateRequest(overrides: Partial<RestStaffAccessRequest> & { apiKeyId: string }) {
  return {
    method: "GET",
    path: "/api/traces/search",
    operation: "traces.search",
    permissions: ["traces:view"],
    scope: { tier: "project" as const, id: `${ACME.id}_project` },
    spends: false,
    ipAddress: AGENT_IP,
    userAgent: "langwatch-cli",
    ...overrides,
  } satisfies RestStaffAccessRequest;
}

function scenarios(backend: Backend): void {
  const world = () => staffAccessWorld({ repositories: backend.repositories() });

  /** A pending request from Olivia's agent. */
  async function pending(
    w: ReturnType<typeof world>,
    scopes: Parameters<typeof requestBody>[0]["scopes"],
  ) {
    const agent = await w.enrol();
    const created = await w.app.createRequest({
      session: agent.session,
      body: requestBody({ scopes }),
    });
    return { agent, created, requestId: created.requestId };
  }

  /** An approved and redeemed session on ACME. */
  async function redeemed(
    w: ReturnType<typeof world>,
    {
      scopes,
      spendApproved = false,
    }: {
      scopes: Parameters<typeof requestBody>[0]["scopes"];
      spendApproved?: boolean;
    },
  ) {
    const { agent, requestId } = await pending(w, scopes);
    const typed = scopes.includes("org:content") || spendApproved;
    await w.approve({
      choice: {
        requestId,
        spendApproved,
        ...(typed ? { typedOrganizationName: ACME.name } : {}),
      },
    });
    const answer = await w.app.redeem({
      session: agent.session,
      requestId,
      codeVerifier: VERIFIER,
    });
    return { agent, requestId, answer };
  }

  describe(`given the ${backend.name} store`, () => {
    describe("when cloud ops or the flag is off", () => {
      /** @scenario "The surface is hidden unless cloud ops and the flag are both on" */
      it("answers not_found at the door and on every operator procedure", async () => {
        const w = world();
        const agent = await w.enrol();
        w.state.flag = false;

        await expect(
          codeOf(
            Promise.resolve(
              w.app.staffAccessDoor.identify?.({
                request: requestFrom({ bearer: agent.requesterKey }),
              }),
            ),
          ),
        ).resolves.toBe("not_found");
        await expect(codeOf(w.app.overview(w.operator(OLIVIA)))).resolves.toBe("not_found");
        await expect(codeOf(w.app.enrolOptions(w.operator(OLIVIA)))).resolves.toBe("not_found");

        w.state.flag = true;
        w.state.cloudOps = false;
        await expect(codeOf(w.app.overview(w.operator(OLIVIA)))).resolves.toBe("not_found");
      });
    });

    describe("when an operator enrols an agent", () => {
      /** @scenario "An operator without a passkey cannot enrol an agent" */
      it("refuses an operator with no passkey and mints nothing", async () => {
        const w = world();

        await expect(codeOf(w.app.enrolOptions(w.operator(PEDRO)))).resolves.toBe(
          "passkey_required",
        );
        await expect(w.app.overview(w.operator(PEDRO))).resolves.toMatchObject({
          hasPasskey: false,
          requesters: [],
        });
      });

      /** @scenario "An operator enrols an agent with a passkey and gets a 90 day requester key" */
      it("shows an lwsr_ key once, valid 90 days, and emails the other operators", async () => {
        const w = world();
        const enrolled = await w.enrol();

        expect(enrolled.requesterKey).toMatch(/^lwsr_/);
        expect(Date.parse(enrolled.requester.expiresAt) - Date.parse("2026-11-02T10:00:00Z")).toBe(
          90 * 24 * 60 * 60 * 1000,
        );
        expect(w.state.mail.map((mail) => mail.to)).toEqual([`${PEDRO}@langwatch.test`]);
        expect(w.state.mail[0]?.subject).toBe("An operator enrolled an agent for staff access");
        expect(w.state.mail[0]?.html).toContain("laptop agent");
        const overview = await w.app.overview(w.operator(OLIVIA));
        expect(JSON.stringify(overview)).not.toContain(enrolled.requesterKey);
      });

      it("refuses an enrolment signed over a challenge it never offered", async () => {
        const w = world();
        await w.app.enrolOptions(w.operator(OLIVIA));

        await expect(
          codeOf(
            w.app.enrol({
              ...w.operator(OLIVIA),
              name: "agent",
              assertion: assertionOver({ challenge: "c".repeat(43) }),
            }),
          ),
        ).resolves.toBe("passkey_assertion_refused");
      });
    });

    describe("when an agent asks for access", () => {
      /** @scenario "A request needs a valid shape" */
      it("refuses a missing scope, an org scope without an organization and a long reason", () => {
        const valid = requestBody({ scopes: ["org:content"] });

        expect(staffAccessRequestBodySchema.validate(valid)).toBe(true);
        for (const body of [
          { ...valid, scopes: [] },
          { ...valid, organization: undefined },
          { ...valid, reason: "x".repeat(501) },
          { ...requestBody({ scopes: ["ops:read"] }), organization: "acme" },
        ]) {
          expect(staffAccessRequestBodySchema.validate(body)).toBe(false);
        }
      });

      /** @scenario "An agent asks for access and gets an approval URL that lasts ten minutes" */
      it("answers a request id and an approval URL that lapses in ten minutes", async () => {
        const w = world();
        const { created } = await pending(w, ["org:content"]);

        expect(created.approvalUrl).toBe(
          `https://app.langwatch.test/ops/agents/approve/${created.requestId}`,
        );
        expect(Date.parse(created.expiresAt) - Date.parse("2026-11-02T10:00:00Z")).toBe(
          10 * 60 * 1000,
        );
        await expect(
          w.app.getApprovalRequest({ ...w.operator(OLIVIA), requestId: created.requestId }),
        ).resolves.toMatchObject({ organizationId: ACME.id, organizationName: ACME.name });
      });

      /** @scenario "A sixth request in one hour is refused" */
      it("refuses the sixth request in an hour with 429", async () => {
        const w = world();
        const agent = await w.enrol();
        const ask = () =>
          w.app.createRequest({
            session: agent.session,
            body: requestBody({ scopes: ["ops:read"] }),
          });
        for (let index = 0; index < 5; index += 1) await ask();

        const refused = await ask().catch((error: { code: string; httpStatus: number }) => error);
        expect(refused).toMatchObject({ code: "staff_access_rate_limited", httpStatus: 429 });
      });

      /** @scenario "A request is refused when the deployment has no public base URL" */
      it("refuses the request with 503 when no approval link can be built", async () => {
        const w = staffAccessWorld({ repositories: backend.repositories(), publicBaseUrl: "" });
        const agent = await w.enrol();

        const refused = await w.app
          .createRequest({ session: agent.session, body: requestBody({ scopes: ["ops:read"] }) })
          .catch((error: { code: string; httpStatus: number }) => error);
        expect(refused).toMatchObject({ code: "staff_access_not_configured", httpStatus: 503 });
      });

      it("refuses an organization that does not exist as not found", async () => {
        const w = world();
        const agent = await w.enrol();

        await expect(
          codeOf(
            w.app.createRequest({
              session: agent.session,
              body: requestBody({ scopes: ["org:metadata"], organization: "nope" }),
            }),
          ),
        ).resolves.toBe("not_found");
      });
    });

    describe("when the operator opens and decides a request", () => {
      /** @scenario "The approval page opens only for the requester's owner" */
      it("answers not found to another operator and the full request to its owner", async () => {
        const w = world();
        w.state.passkeys.add(PEDRO);
        const { requestId } = await pending(w, ["org:content"]);

        await expect(
          codeOf(w.app.getApprovalRequest({ ...w.operator(PEDRO), requestId })),
        ).resolves.toBe("not_found");
        await expect(
          w.app.getApprovalRequest({ ...w.operator(OLIVIA), requestId }),
        ).resolves.toMatchObject({
          organizationName: ACME.name,
          scopes: ["org:content"],
          reason: "fix ACME's broken evaluator",
          machine: "olivia-macbook",
          requestIp: AGENT_IP,
          expiresAt: "2026-11-02T10:10:00.000Z",
          status: "pending",
        });
      });

      /** @scenario "Content access needs the organization name typed" */
      it("refuses a content approval whose typed name does not match", async () => {
        const w = world();
        const { requestId } = await pending(w, ["org:content"]);

        await expect(
          codeOf(
            w.app.approvalOptions({
              ...w.operator(OLIVIA),
              requestId,
              spendApproved: false,
              typedOrganizationName: "ACME Corp",
            }),
          ),
        ).resolves.toBe("organization_name_mismatch");
      });

      /** @scenario "Support with spend needs the organization name typed" */
      it("asks for the typed name only once spend is ticked", async () => {
        const w = world();
        const { requestId } = await pending(w, ["org:support"]);

        await expect(
          codeOf(w.app.approvalOptions({ ...w.operator(OLIVIA), requestId, spendApproved: true })),
        ).resolves.toBe("organization_name_mismatch");
        await expect(
          w.app.approvalOptions({ ...w.operator(OLIVIA), requestId, spendApproved: false }),
        ).resolves.toMatchObject({ userVerification: "required" });
      });

      /** @scenario "The passkey signs a hash of exactly what is shown" */
      it("refuses an assertion made over the choice with spend on for an approval with spend off", async () => {
        const w = world();
        const { requestId } = await pending(w, ["org:support"]);
        const withSpend = await w.app.approvalOptions({
          ...w.operator(OLIVIA),
          requestId,
          spendApproved: true,
          typedOrganizationName: ACME.name,
        });

        await expect(
          codeOf(
            w.app.approve({
              ...w.operator(OLIVIA),
              requestId,
              spendApproved: false,
              assertion: assertionOver({ challenge: withSpend.challenge }),
            }),
          ),
        ).resolves.toBe("passkey_assertion_refused");
        await expect(
          w.app.getApprovalRequest({ ...w.operator(OLIVIA), requestId }),
        ).resolves.toMatchObject({ status: "pending" });
      });

      /** @scenario "Approval needs user verification" */
      it("refuses an assertion without user verification and leaves the request pending", async () => {
        const w = world();
        const { requestId } = await pending(w, ["org:metadata"]);
        const options = await w.app.approvalOptions({
          ...w.operator(OLIVIA),
          requestId,
          spendApproved: false,
        });

        await expect(
          codeOf(
            w.app.approve({
              ...w.operator(OLIVIA),
              requestId,
              spendApproved: false,
              assertion: assertionOver({ challenge: options.challenge, userVerified: false }),
            }),
          ),
        ).resolves.toBe("passkey_assertion_refused");
        await expect(
          w.app.getApprovalRequest({ ...w.operator(OLIVIA), requestId }),
        ).resolves.toMatchObject({ status: "pending" });
      });

      /** @scenario "An approval lands in the customer's audit log and notifies the other operators" */
      it("writes staffAccess.approved to ACME's log and emails the other operators", async () => {
        const w = world();
        const { requestId } = await pending(w, ["org:support"]);
        w.state.mail.length = 0;

        await w.approve({ choice: { requestId, spendApproved: false } });

        expect(w.state.audit).toEqual([
          expect.objectContaining({
            organizationId: ACME.id,
            action: "staffAccess.approved",
            userId: OLIVIA,
            metadata: expect.objectContaining({
              principal: "LangWatch Support",
              approvedBy: expect.objectContaining({ name: "Olivia" }),
              reason: "fix ACME's broken evaluator",
            }),
          }),
        ]);
        expect(w.state.mail.map((mail) => mail.to)).toEqual([`${PEDRO}@langwatch.test`]);
      });

      /** @scenario "An expired request cannot be approved or redeemed" */
      it("refuses approving and redeeming a request past its ten minutes", async () => {
        const w = world();
        const { agent, requestId } = await pending(w, ["org:metadata"]);
        w.advance({ minutes: 11 });

        await expect(
          codeOf(w.approve({ choice: { requestId, spendApproved: false } })),
        ).resolves.toBe("request_expired");
        await expect(
          codeOf(w.app.redeem({ session: agent.session, requestId, codeVerifier: VERIFIER })),
        ).resolves.toBe("request_expired");
      });

      /** @scenario "A denied request cannot be redeemed" */
      it("refuses redeeming a denied request", async () => {
        const w = world();
        const { agent, requestId } = await pending(w, ["org:metadata"]);
        await w.app.deny({ ...w.operator(OLIVIA), requestId });

        await expect(
          codeOf(w.app.redeem({ session: agent.session, requestId, codeVerifier: VERIFIER })),
        ).resolves.toBe("request_not_approved");
      });

      it("lets only one of two racing approvals win", async () => {
        const w = world();
        const { requestId } = await pending(w, ["org:metadata"]);
        const options = await w.app.approvalOptions({
          ...w.operator(OLIVIA),
          requestId,
          spendApproved: false,
        });
        const approve = () =>
          w.app.approve({
            ...w.operator(OLIVIA),
            requestId,
            spendApproved: false,
            assertion: assertionOver({ challenge: options.challenge }),
          });

        const results = await Promise.allSettled([approve(), approve()]);
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(w.state.audit.filter((row) => row.action === "staffAccess.approved")).toHaveLength(
          1,
        );
      });
    });

    describe("when the agent redeems", () => {
      /** @scenario "Redeem needs the right verifier and does not spend the request on a wrong one" */
      it("refuses a wrong verifier and still accepts the right one", async () => {
        const w = world();
        const { agent, requestId } = await pending(w, ["org:metadata"]);
        await w.approve({ choice: { requestId, spendApproved: false } });

        await expect(
          codeOf(w.app.redeem({ session: agent.session, requestId, codeVerifier: "w".repeat(43) })),
        ).resolves.toBe("invalid_code_verifier");
        await expect(
          w.app.redeem({ session: agent.session, requestId, codeVerifier: VERIFIER }),
        ).resolves.toMatchObject({ organizationId: ACME.id });
      });

      /** @scenario "Redeem needs the requester key that made the request" */
      it("answers not found to another requester key", async () => {
        const w = world();
        const { requestId } = await pending(w, ["org:metadata"]);
        await w.approve({ choice: { requestId, spendApproved: false } });
        const other = await w.enrol({ name: "second agent" });

        await expect(
          codeOf(w.app.redeem({ session: other.session, requestId, codeVerifier: VERIFIER })),
        ).resolves.toBe("not_found");
      });

      /** @scenario "A request is redeemed once and the key lasts one hour" */
      it("mints a one-hour Staff Read key once", async () => {
        const w = world();
        const { agent, requestId, answer } = await redeemed(w, { scopes: ["org:content"] });

        expect(answer).toMatchObject({
          apiKey: expect.any(String),
          organizationId: ACME.id,
          projects: [{ slug: "acme-support" }],
          expiresAt: "2026-11-02T11:00:00.000Z",
        });
        expect(answer.opsToken).toBeUndefined();
        expect(w.state.minted).toEqual([
          expect.objectContaining({ kind: "read", organizationId: ACME.id }),
        ]);
        expect(w.state.minted[0]?.expiresAt.toISOString()).toBe("2026-11-02T11:00:00.000Z");
        await expect(
          codeOf(w.app.redeem({ session: agent.session, requestId, codeVerifier: VERIFIER })),
        ).resolves.toBe("already_redeemed");
      });

      /** @scenario "Ops read alone mints no organization key" */
      it("answers an lwsa_ ops token and no API key for ops:read alone", async () => {
        const w = world();
        const { answer } = await redeemed(w, { scopes: ["ops:read"] });

        expect(answer.opsToken).toMatch(/^lwsa_/);
        expect(answer.apiKey).toBeUndefined();
        expect(w.state.minted).toEqual([]);
      });
    });

    describe("when a redeemed key is used", () => {
      /** @scenario "A support key without the spend tick cannot start a run" */
      it("refuses a spending route with staff_spend_not_approved", async () => {
        const w = world();
        await redeemed(w, { scopes: ["org:support"] });
        const apiKeyId = w.state.minted[0]?.apiKeyId ?? "";

        await expect(
          codeOf(
            w.app.staffAccessGate.admit(gateRequest({ apiKeyId, method: "POST", spends: true })),
          ),
        ).resolves.toBe("staff_spend_not_approved");
      });

      it("admits a spending route once spend was approved and writes staffAccess.write", async () => {
        const w = world();
        const { requestId } = await redeemed(w, { scopes: ["org:support"], spendApproved: true });
        const apiKeyId = w.state.minted[0]?.apiKeyId ?? "";

        const receipt = await w.app.staffAccessGate.admit(
          gateRequest({
            apiKeyId,
            method: "POST",
            path: "/api/suites/run",
            permissions: ["scenarios:create"],
            spends: true,
          }),
        );
        await receipt.finish({ status: 201, errorCode: null, durationMs: 12 });

        expect(w.state.audit.at(-1)).toMatchObject({
          action: "staffAccess.write",
          organizationId: ACME.id,
          userId: OLIVIA,
          metadata: { principal: "LangWatch Support", reason: "fix ACME's broken evaluator" },
        });
        await expect(w.repositories.events.findByRequest({ requestId })).resolves.toEqual([
          expect.objectContaining({ path: "/api/suites/run", status: 201, ipAddress: AGENT_IP }),
        ]);
      });

      /** @scenario "The key is pinned to the address that redeemed it" */
      it("refuses the key from another address", async () => {
        const w = world();
        await redeemed(w, { scopes: ["org:content"] });
        const apiKeyId = w.state.minted[0]?.apiKeyId ?? "";

        await expect(
          codeOf(w.app.staffAccessGate.admit(gateRequest({ apiKeyId, ipAddress: "198.51.100.9" }))),
        ).resolves.toBe("staff_access_ip_mismatch");
      });

      /** @scenario "A key stops working after one hour" */
      it("refuses the key after its hour", async () => {
        const w = world();
        await redeemed(w, { scopes: ["org:content"] });
        const apiKeyId = w.state.minted[0]?.apiKeyId ?? "";
        await w.app.staffAccessGate.admit(gateRequest({ apiKeyId }));
        w.advance({ minutes: 61 });

        await expect(codeOf(w.app.staffAccessGate.admit(gateRequest({ apiKeyId })))).resolves.toBe(
          "staff_access_expired",
        );
      });

      /** @scenario "Revoking an undecided request means it can no longer be approved" */
      it("ends a pending request so it cannot be approved, with no customer audit row", async () => {
        const w = world();
        const { requestId } = await pending(w, ["org:metadata"]);

        await w.app.revokeSession({ ...w.operator(PEDRO), requestId });

        await expect(
          codeOf(w.approve({ choice: { requestId, spendApproved: false } })),
        ).resolves.toBe("request_not_pending");
        expect(w.state.audit.filter((row) => row.targetId === requestId)).toEqual([]);
      });

      /** @scenario "Revoking a session that already ended is refused" */
      it("refuses to revoke a session its agent already ended", async () => {
        const w = world();
        const { agent, requestId } = await redeemed(w, { scopes: ["org:metadata"] });
        await w.app.endSession({ session: agent.session, requestId });

        await expect(
          codeOf(w.app.revokeSession({ ...w.operator(PEDRO), requestId })),
        ).resolves.toBe("staff_access_already_ended");
      });

      /** @scenario "Revoking a session whose hour ran out is refused" */
      it("refuses to revoke an expired session, before and after the sweep audits it", async () => {
        const w = world();
        const { requestId } = await redeemed(w, { scopes: ["org:metadata"] });
        w.advance({ minutes: 61 });

        await expect(
          codeOf(w.app.revokeSession({ ...w.operator(PEDRO), requestId })),
        ).resolves.toBe("staff_access_already_ended");
        await w.app.sweepExpiredSessions({ at: w.state.at.epochMilliseconds });
        await expect(
          codeOf(w.app.revokeSession({ ...w.operator(PEDRO), requestId })),
        ).resolves.toBe("staff_access_already_ended");

        const ends = w.state.audit.filter(
          (row) => row.targetId === requestId && row.action !== "staffAccess.approved",
        );
        expect(ends.map((row) => row.action)).toEqual(["staffAccess.expired"]);
      });

      /** @scenario "The kill switch also ends undecided requests" */
      it("ends pending requests too", async () => {
        const w = world();
        const { requestId } = await pending(w, ["org:metadata"]);

        await w.app.revokeAll({ ...w.operator(PEDRO), confirmation: "revoke all" });

        await expect(
          codeOf(w.approve({ choice: { requestId, spendApproved: false } })),
        ).resolves.toBe("request_not_pending");
      });

      /** @scenario "The kill switch revokes every live key" */
      it("revokes every live session after the typed confirmation", async () => {
        const w = world();
        const first = await redeemed(w, { scopes: ["org:content"] });
        const second = await redeemed(w, { scopes: ["org:metadata"] });
        const keys = w.state.minted.map((key) => key.apiKeyId);

        await expect(
          codeOf(w.app.revokeAll({ ...w.operator(PEDRO), confirmation: "revoke" })),
        ).resolves.toBe("staff_access_confirmation_mismatch");
        const { revoked, failed } = await w.app.revokeAll({
          ...w.operator(PEDRO),
          confirmation: "revoke all",
        });

        expect(revoked).toBeGreaterThanOrEqual(2);
        expect(failed).toBe(0);
        expect(w.state.revokedKeys).toEqual(expect.arrayContaining(keys));
        for (const apiKeyId of keys) {
          await expect(
            codeOf(w.app.staffAccessGate.admit(gateRequest({ apiKeyId }))),
          ).resolves.toBe("staff_access_revoked");
        }
        const revokedRows = w.state.audit.filter((row) => row.action === "staffAccess.revoked");
        expect(revokedRows.map((row) => row.targetId)).toEqual(
          expect.arrayContaining([first.requestId, second.requestId]),
        );
        expect(revokedRows.every((row) => row.organizationId === ACME.id)).toBe(true);
      });

      /** @scenario "A key stops when its approver loses the operator grant" */
      it("refuses the key once its approver is no longer an operator", async () => {
        const w = world();
        await redeemed(w, { scopes: ["org:content"] });
        const apiKeyId = w.state.minted[0]?.apiKeyId ?? "";
        w.state.operators = [PEDRO];

        await expect(codeOf(w.app.staffAccessGate.admit(gateRequest({ apiKeyId })))).resolves.toBe(
          "staff_access_operator_lost",
        );
      });

      /** @scenario "Natural expiry is audited" */
      it("audits a session's natural end once", async () => {
        const w = world();
        const { requestId } = await redeemed(w, { scopes: ["org:content"] });
        w.advance({ minutes: 61 });
        const at = w.state.at.epochMilliseconds;

        await w.app.sweepExpiredSessions({ at });
        await w.app.sweepExpiredSessions({ at });

        expect(
          w.state.audit.filter(
            (row) => row.action === "staffAccess.expired" && row.targetId === requestId,
          ),
        ).toHaveLength(1);
      });

      it("ends the agent's own session on request", async () => {
        const w = world();
        const { agent, requestId } = await redeemed(w, { scopes: ["org:content"] });

        await expect(w.app.endSession({ session: agent.session, requestId })).resolves.toEqual({
          ended: true,
        });
        await expect(
          w.app.getRequestStatus({ session: agent.session, requestId }),
        ).resolves.toMatchObject({ status: "revoked" });
      });
    });

    describe("when the agent redeems from another address", () => {
      /** @scenario "Redeem must come from the address the operator approved" */
      it("refuses a redeem from any other address and spends nothing", async () => {
        const w = world();
        const { agent, requestId } = await pending(w, ["org:metadata"]);
        await w.approve({ choice: { requestId, spendApproved: false } });

        await expect(
          codeOf(
            w.app.redeem({
              session: { ...agent.session, ipAddress: "198.51.100.9" },
              requestId,
              codeVerifier: VERIFIER,
            }),
          ),
        ).resolves.toBe("staff_access_ip_mismatch");
        expect(w.state.minted).toEqual([]);
        await expect(
          w.app.redeem({ session: agent.session, requestId, codeVerifier: VERIFIER }),
        ).resolves.toMatchObject({ organizationId: ACME.id });
      });

      /** @scenario "A request or redeem with no client address is refused" */
      it("refuses to create or redeem a request without an address", async () => {
        const w = world();
        const agent = await w.enrol();
        const noAddress = { ...agent.session, ipAddress: null };

        await expect(
          codeOf(
            w.app.createRequest({
              session: noAddress,
              body: requestBody({ scopes: ["org:metadata"] }),
            }),
          ),
        ).resolves.toBe("staff_access_ip_mismatch");

        const { requestId } = await w.app.createRequest({
          session: agent.session,
          body: requestBody({ scopes: ["org:metadata"] }),
        });
        await w.approve({ choice: { requestId, spendApproved: false } });
        await expect(
          codeOf(w.app.redeem({ session: noAddress, requestId, codeVerifier: VERIFIER })),
        ).resolves.toBe("staff_access_ip_mismatch");
        expect(w.state.minted).toEqual([]);
      });

      /** @scenario "Other operators are told when an agent redeems" */
      it("emails the other operators when a session starts", async () => {
        const w = world();
        const { requestId } = await redeemed(w, { scopes: ["org:metadata"] });

        expect(
          w.state.mail.filter((mail) =>
            mail.idempotencyKey?.startsWith(`staff-access-redeemed:${requestId}`),
          ),
        ).toEqual([expect.objectContaining({ to: `${PEDRO}@langwatch.test` })]);
      });
    });

    describe("when an approval cannot be fully written", () => {
      const approvalRows = (w: ReturnType<typeof world>, requestId: string) =>
        w.state.audit.filter(
          (row) => row.targetId === requestId && row.action === "staffAccess.approved",
        );

      /** @scenario "An approval whose approver lookup fails is ended" */
      it("refuses the approval when the approver cannot be read, and nothing is redeemable", async () => {
        const w = world();
        const { agent, requestId } = await pending(w, ["org:metadata"]);
        w.state.usersRefused = true;

        await expect(
          codeOf(w.approve({ choice: { requestId, spendApproved: false } })),
        ).resolves.toBe("staff_access_audit_unavailable");
        w.state.usersRefused = false;

        await expect(
          codeOf(w.app.redeem({ session: agent.session, requestId, codeVerifier: VERIFIER })),
        ).resolves.toBe("request_not_approved");
        expect(approvalRows(w, requestId)).toEqual([]);
        expect(w.state.minted).toEqual([]);
      });

      /** @scenario "An approval stays unredeemable when its audit row and its revoke both fail" */
      it("leaves the request approving, never redeemable, when the compensating revoke fails", async () => {
        const w = world();
        const { agent, requestId } = await pending(w, ["org:metadata"]);
        w.state.auditRefused = true;
        const requests = w.repositories.requests;
        const revoke = requests.revoke.bind(requests);
        requests.revoke = async () => {
          throw new Error("store unavailable");
        };

        await expect(
          codeOf(w.approve({ choice: { requestId, spendApproved: false } })),
        ).resolves.toBe("staff_access_audit_unavailable");
        requests.revoke = revoke;
        w.state.auditRefused = false;

        await expect(
          codeOf(w.app.redeem({ session: agent.session, requestId, codeVerifier: VERIFIER })),
        ).resolves.toBe("request_not_approved");
        await expect(
          w.app.getRequestStatus({ session: agent.session, requestId }),
        ).resolves.toMatchObject({ status: "pending" });

        w.advance({ minutes: 11 });
        await w.app.sweepExpiredSessions({ at: w.state.at.epochMilliseconds });
        expect(w.state.audit.filter((row) => row.targetId === requestId)).toEqual([]);
        await expect(
          w.app.getRequestStatus({ session: agent.session, requestId }),
        ).resolves.toMatchObject({ status: "expired" });
      });

      /** @scenario "A crash between the approval claim and its audit row leaves nothing redeemable" */
      it("never redeems a request claimed for approval whose audit row was never written", async () => {
        const w = world();
        const { agent, requestId } = await pending(w, ["org:metadata"]);
        await w.repositories.requests.claimApproval({
          id: requestId,
          at: w.state.at,
          spendApproved: false,
          credentialId: "credential1",
          signature: "c2lnbmVk",
          signedHash: "hash",
        });

        await expect(
          codeOf(w.app.redeem({ session: agent.session, requestId, codeVerifier: VERIFIER })),
        ).resolves.toBe("request_not_approved");
        w.advance({ minutes: 11 });
        await w.app.sweepExpiredSessions({ at: w.state.at.epochMilliseconds });
        expect(w.state.audit.filter((row) => row.targetId === requestId)).toEqual([]);
      });

      /** @scenario "An approval whose confirm fails after its audit row is ended and the end is audited" */
      it("refuses the approval and the sweep tells the customer it ended", async () => {
        const w = world();
        const { agent, requestId } = await pending(w, ["org:metadata"]);
        const requests = w.repositories.requests;
        const confirm = requests.confirmApproval.bind(requests);
        requests.confirmApproval = async () => {
          throw new Error("store unavailable");
        };

        await expect(
          codeOf(w.approve({ choice: { requestId, spendApproved: false } })),
        ).resolves.toBe("staff_access_audit_unavailable");
        requests.confirmApproval = confirm;
        await expect(
          codeOf(w.app.redeem({ session: agent.session, requestId, codeVerifier: VERIFIER })),
        ).resolves.toBe("request_not_approved");

        await w.app.sweepExpiredSessions({ at: w.state.at.epochMilliseconds });
        await w.app.sweepExpiredSessions({ at: w.state.at.epochMilliseconds });
        expect(
          w.state.audit.filter((row) => row.targetId === requestId).map((row) => row.action),
        ).toEqual(["staffAccess.approved", "staffAccess.revoked"]);
      });
    });

    describe("when ending a session cannot be fully written", () => {
      const endRows = (w: ReturnType<typeof world>, requestId: string) =>
        w.state.audit
          .filter((row) => row.targetId === requestId && row.action !== "staffAccess.approved")
          .map((row) => row.action);

      /** @scenario "A revoke whose audit row fails is retried by the sweep" */
      it("writes the revoked row on the next sweep after a failed audit write", async () => {
        const w = world();
        const { requestId } = await redeemed(w, { scopes: ["org:metadata"] });
        w.state.auditRefused = true;

        await expect(w.app.revokeSession({ ...w.operator(PEDRO), requestId })).rejects.toThrow(
          "unavailable",
        );
        await expect(
          codeOf(w.app.revokeSession({ ...w.operator(PEDRO), requestId })),
        ).resolves.toBe("staff_access_already_ended");
        expect(endRows(w, requestId)).toEqual([]);

        w.state.auditRefused = false;
        await w.app.sweepExpiredSessions({ at: w.state.at.epochMilliseconds });
        await w.app.sweepExpiredSessions({ at: w.state.at.epochMilliseconds });
        expect(endRows(w, requestId)).toEqual(["staffAccess.revoked"]);
        const [revokedRow] = w.state.audit.filter((row) => row.action === "staffAccess.revoked");
        expect(revokedRow).toMatchObject({
          actorUserId: PEDRO,
          metadata: expect.objectContaining({
            approvedBy: expect.objectContaining({ id: OLIVIA, name: "Olivia" }),
            revokedBy: expect.objectContaining({ id: PEDRO, name: "Pedro" }),
          }),
        });
      });

      /** @scenario "A revoke whose key revoke fails is retried by the sweep" */
      it("revokes the key and writes the row on the next sweep after a failed key revoke", async () => {
        const w = world();
        const { requestId } = await redeemed(w, { scopes: ["org:metadata"] });
        const apiKeyId = w.state.minted[0]?.apiKeyId ?? "";
        w.state.keyRevokeRefused.add(apiKeyId);

        await expect(w.app.revokeSession({ ...w.operator(PEDRO), requestId })).rejects.toThrow(
          "unavailable",
        );
        await expect(codeOf(w.app.staffAccessGate.admit(gateRequest({ apiKeyId })))).resolves.toBe(
          "staff_access_revoked",
        );

        w.state.keyRevokeRefused.clear();
        await w.app.sweepExpiredSessions({ at: w.state.at.epochMilliseconds });
        expect(w.state.revokedKeys).toContain(apiKeyId);
        expect(endRows(w, requestId)).toEqual(["staffAccess.revoked"]);
      });

      /** @scenario "A natural expiry whose audit row fails is retried by the sweep" */
      it("audits the expiry on a later sweep after a failed write", async () => {
        const w = world();
        const { requestId } = await redeemed(w, { scopes: ["org:metadata"] });
        w.advance({ minutes: 61 });
        w.state.auditRefused = true;

        await expect(
          w.app.sweepExpiredSessions({ at: w.state.at.epochMilliseconds }),
        ).resolves.toEqual({ audited: 0 });
        w.state.auditRefused = false;
        await w.app.sweepExpiredSessions({ at: w.state.at.epochMilliseconds });
        await w.app.sweepExpiredSessions({ at: w.state.at.epochMilliseconds });
        expect(endRows(w, requestId)).toEqual(["staffAccess.expired"]);
      });

      /** @scenario "An approval that was never redeemed is audited when it lapses" */
      it("tells the customer an approved request lapsed unredeemed", async () => {
        const w = world();
        const { requestId } = await pending(w, ["org:metadata"]);
        await w.approve({ choice: { requestId, spendApproved: false } });
        w.advance({ minutes: 11 });

        await w.app.sweepExpiredSessions({ at: w.state.at.epochMilliseconds });
        expect(endRows(w, requestId)).toEqual(["staffAccess.expired"]);
      });

      /** @scenario "The kill switch reports how many sessions ended and how many failed" */
      it("ends the others and counts the one that failed", async () => {
        const w = world();
        const first = await redeemed(w, { scopes: ["org:metadata"] });
        const second = await redeemed(w, { scopes: ["org:metadata"] });
        const failing = w.state.minted[0]?.apiKeyId ?? "";
        w.state.keyRevokeRefused.add(failing);

        const killed = await w.app.revokeAll({ ...w.operator(PEDRO), confirmation: "revoke all" });
        expect(killed.failed).toBe(1);
        expect(killed.revoked).toBeGreaterThanOrEqual(1);
        expect(endRows(w, second.requestId)).toEqual(["staffAccess.revoked"]);

        w.state.keyRevokeRefused.clear();
        await w.app.sweepExpiredSessions({ at: w.state.at.epochMilliseconds });
        expect(endRows(w, first.requestId)).toEqual(["staffAccess.revoked"]);
      });
    });

    describe("when an operator revokes an enrolled agent", () => {
      /** @scenario "Revoking an agent ends its live sessions and requests" */
      it("revokes its keys, ends its requests, audits the end and tells the other operators", async () => {
        const w = world();
        const { agent, requestId } = await redeemed(w, { scopes: ["org:metadata"] });
        const apiKeyId = w.state.minted[0]?.apiKeyId ?? "";
        const asked = await w.app.createRequest({
          session: agent.session,
          body: requestBody({ scopes: ["org:metadata"] }),
        });

        await w.app.revokeRequester({ ...w.operator(OLIVIA), requesterId: agent.requester.id });

        expect(w.state.revokedKeys).toContain(apiKeyId);
        await expect(codeOf(w.app.staffAccessGate.admit(gateRequest({ apiKeyId })))).resolves.toBe(
          "staff_access_revoked",
        );
        await expect(
          codeOf(w.approve({ choice: { requestId: asked.requestId, spendApproved: false } })),
        ).resolves.toBe("request_not_pending");
        expect(
          w.state.audit
            .filter((row) => row.action === "staffAccess.revoked")
            .map((row) => [row.targetId, (row.metadata as { cause?: string }).cause]),
        ).toEqual([[requestId, "requester_revoked"]]);
        expect(
          w.state.mail.filter((mail) =>
            mail.idempotencyKey?.startsWith(`staff-access-requester-revoked:${agent.requester.id}`),
          ),
        ).toEqual([expect.objectContaining({ to: `${PEDRO}@langwatch.test` })]);
      });
    });

    describe("when an ops token reads the allowlist", () => {
      async function opsCaller(w: ReturnType<typeof world>) {
        const { answer, requestId } = await redeemed(w, { scopes: ["ops:read"] });
        const caller = await Promise.resolve(
          w.app.staffAccessDoor.identify?.({
            request: requestFrom({ bearer: answer.opsToken ?? "" }),
          }),
        );
        return { caller, requestId, session: caller?.session as StaffAccessDoorSession };
      }

      /** @scenario "Ops read answers whether an organization still uses coding agents" */
      it("answers usage with the classification and writes a trail row", async () => {
        const w = world();
        const { session, requestId } = await opsCaller(w);

        const usage = await w.app.getOrganizationUsage({ session, organization: ACME.slug });

        expect(usage).toMatchObject({
          organization: { id: ACME.id },
          codingAgentSessions: {
            last7Days: 4,
            last30Days: 9,
            lastSessionAt: "2026-11-01T08:00:00.000Z",
          },
          gateway: { requests30Days: 120, spendUsd30Days: 3.5 },
          apiKeys: [{ id: "key_customer", lastUsedAt: "2026-11-01T09:00:00.000Z" }],
          membersSignedIn: 2,
        });
        expect(usage.classification).toContain("membersSignedIn");
        await expect(w.repositories.events.findByRequest({ requestId })).resolves.toEqual([
          expect.objectContaining({
            operation: "staffAccess.getOrganizationUsage",
            organizationId: ACME.id,
            status: 200,
          }),
        ]);
      });

      /** @scenario "Ops read is an allowlist" */
      it("answers opsRead:view for an ops token and no other platform permission", async () => {
        const w = world();
        const { caller } = await opsCaller(w);
        const door = w.app.staffAccessDoor;

        expect(
          door.authorizePlatform?.({ caller: caller as never, permission: "opsRead:view" }),
        ).toEqual({ permitted: true });
        expect(
          door.authorizePlatform?.({ caller: caller as never, permission: "ops:view" }),
        ).toEqual({ permitted: false });
      });

      /** @scenario "An organization key cannot call ops read routes" */
      it("refuses an organization key at the ops door", async () => {
        const w = world();
        const { answer } = await redeemed(w, { scopes: ["org:content"] });

        await expect(
          codeOf(
            Promise.resolve(
              w.app.staffAccessDoor.identify?.({
                request: requestFrom({ bearer: answer.apiKey ?? "" }),
              }),
            ),
          ),
        ).resolves.toBe("invalid_credentials");
      });

      it("refuses the ops token from another address", async () => {
        const w = world();
        const { answer } = await redeemed(w, { scopes: ["ops:read"] });

        await expect(
          codeOf(
            Promise.resolve(
              w.app.staffAccessDoor.identify?.({
                request: requestFrom({ bearer: answer.opsToken ?? "", ip: "198.51.100.9" }),
              }),
            ),
          ),
        ).resolves.toBe("staff_access_ip_mismatch");
      });
    });
  });
}

scenarios({ name: "memory", repositories: () => MemoryStaffAccessRepositories.create() });

describe("given a trail store that refuses writes", () => {
  /** @scenario "A failed trail write refuses the request" */
  it("refuses the request with 503 staff_access_audit_unavailable", async () => {
    const repositories = MemoryStaffAccessRepositories.create();
    const w = staffAccessWorld({ repositories });
    const agent = await w.enrol();
    const { requestId } = await w.app.createRequest({
      session: agent.session,
      body: requestBody({ scopes: ["org:content"] }),
    });
    await w.approve({
      choice: { requestId, spendApproved: false, typedOrganizationName: ACME.name },
    });
    await w.app.redeem({ session: agent.session, requestId, codeVerifier: VERIFIER });
    (repositories.events as MemoryStaffAccessEventRepository).refuseWrites = true;

    const refused = await w.app.staffAccessGate
      .admit(gateRequest({ apiKeyId: w.state.minted[0]?.apiKeyId ?? "" }))
      .catch((error: { code: string; httpStatus: number }) => error);
    expect(refused).toMatchObject({ code: "staff_access_audit_unavailable", httpStatus: 503 });
  });
});

describe("given a customer audit log that refuses the approval row", () => {
  /** @scenario "An approval the customer audit log did not take is ended" */
  it("refuses the approval with 503 and the agent can never redeem it", async () => {
    const w = staffAccessWorld({ repositories: MemoryStaffAccessRepositories.create() });
    const agent = await w.enrol();
    const { requestId } = await w.app.createRequest({
      session: agent.session,
      body: requestBody({ scopes: ["org:content"] }),
    });
    w.state.auditRefused = true;

    const refused = await codeOf(
      w.approve({ choice: { requestId, spendApproved: false, typedOrganizationName: ACME.name } }),
    );
    const redeem = await codeOf(
      w.app.redeem({ session: agent.session, requestId, codeVerifier: VERIFIER }),
    );

    expect(refused).toBe("staff_access_audit_unavailable");
    expect(redeem).toBe("request_not_approved");
    expect(w.state.minted).toEqual([]);
  });
});

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("staff-access-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

/** Every row these tests write belongs to the two test operators. */
async function removeTestRows(): Promise<void> {
  const prisma = connection?.client;
  if (!prisma) return;
  const owners = { in: [OLIVIA, PEDRO] };
  const requests = await prisma.staffAccessRequest.findMany({
    where: { ownerUserId: owners },
    select: { id: true },
  });
  await prisma.staffAccessEvent.deleteMany({
    where: { requestId: { in: requests.map((request) => request.id) } },
  });
  await prisma.staffAccessRequest.deleteMany({ where: { ownerUserId: owners } });
  await prisma.staffAccessRequester.deleteMany({ where: { ownerUserId: owners } });
  await prisma.staffAccessChallenge.deleteMany({ where: { userId: owners } });
}

describe.skipIf(!connection)("on Postgres", () => {
  beforeAll(removeTestRows);
  afterAll(async () => {
    await removeTestRows();
    await connection?.client.$disconnect();
  });

  scenarios({
    name: "Postgres",
    repositories: () => {
      if (!connection) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
      return PostgresStaffAccessRepositories.create({ prisma: connection.client });
    },
  });
});
