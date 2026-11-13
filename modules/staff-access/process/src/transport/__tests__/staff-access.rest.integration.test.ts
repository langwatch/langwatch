/**
 * The `/api/staff-access` family mounted on a REST runtime behind the module's own door, over
 * the memory twins: what the CLI sends, answered as the CLI reads it.
 * @see modules/staff-access/specs/staff-access-approval.feature
 */
import { ClientAddress } from "@langwatch/api/policy";
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import {
  ACME,
  AGENT_IP,
  GLOBEX,
  requestBody,
  staffAccessWorld,
  VERIFIER,
} from "../../app/__tests__/support/staff-access-world.ts";
import { MemoryStaffAccessRepositories } from "../../repositories/memory/memory.staff-access.repositories.ts";
import { staffAccessRest } from "../staff-access.rest.ts";

function mount() {
  const w = staffAccessWorld({ repositories: MemoryStaffAccessRepositories.create() });
  const runtime = createRestRuntime({
    authorization: restTestAuthorization(),
    audit: { record: () => {} },
    identity: w.app.staffAccessDoor,
    doors: { staff_access: w.app.staffAccessDoor },
  });
  const hono = runtime.mount(staffAccessRest.router(), {
    app: () => w.app,
    onError: canonicalErrorResponse,
  });
  const send = async ({
    method = "GET",
    path,
    bearer,
    body,
  }: {
    method?: string;
    path: string;
    bearer: string;
    body?: unknown;
  }) => {
    const request = new Request(`https://app.langwatch.test${path}`, {
      method,
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        "user-agent": "langwatch-cli",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    ClientAddress.fromTrustedProxies({}).handle({ request, socketAddress: AGENT_IP });
    const response = await hono.fetch(request);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  return { w, send };
}

describe("given the staff access REST family", () => {
  describe("when an agent walks a request from asking to reading usage", () => {
    it("answers the CLI's wire at each step", async () => {
      const { w, send } = mount();
      const agent = await w.enrol();

      const created = await send({
        method: "POST",
        path: "/api/staff-access/requests",
        bearer: agent.requesterKey,
        body: requestBody({ scopes: ["ops:read", "org:content"] }),
      });
      expect(created).toMatchObject({ status: 200, body: { requestId: expect.any(String) } });
      const requestId = String(created.body.requestId);

      await expect(
        send({ path: `/api/staff-access/requests/${requestId}`, bearer: agent.requesterKey }),
      ).resolves.toMatchObject({ status: 200, body: { status: "pending" } });

      await w.approve({
        choice: { requestId, spendApproved: false, typedOrganizationName: ACME.name },
      });
      const redeemed = await send({
        method: "POST",
        path: `/api/staff-access/requests/${requestId}/redeem`,
        bearer: agent.requesterKey,
        body: { codeVerifier: VERIFIER },
      });
      expect(redeemed).toMatchObject({
        status: 200,
        body: { apiKey: expect.any(String), opsToken: expect.stringMatching(/^lwsa_/) },
      });
      const opsToken = String(redeemed.body.opsToken);

      await expect(
        send({ path: "/api/staff-access/ops/organizations?query=acm", bearer: opsToken }),
      ).resolves.toMatchObject({ status: 200, body: { organizations: [{ slug: "acme" }] } });
      await expect(
        send({ path: `/api/staff-access/ops/organizations/${ACME.slug}/usage`, bearer: opsToken }),
      ).resolves.toMatchObject({ status: 200, body: { organization: { id: ACME.id } } });
      await expect(
        send({ path: "/api/staff-access/ops/queues", bearer: opsToken }),
      ).resolves.toMatchObject({ status: 200, body: { queues: [{ name: "events" }] } });

      await expect(
        send({
          method: "POST",
          path: `/api/staff-access/requests/${requestId}/end`,
          bearer: agent.requesterKey,
          body: {},
        }),
      ).resolves.toMatchObject({ status: 200, body: { ended: true } });
    });
  });

  describe("when an agent copies ACME into Globex over the wire", () => {
    /** @scenario "The source ops token never shows in an answer, a trail row or an audit row" */
    it("answers the copy and never echoes the source token", async () => {
      const { w, send } = mount();
      const agent = await w.enrol();
      const side = async (organization: typeof ACME, other: typeof ACME, scope: string) => {
        const created = await send({
          method: "POST",
          path: "/api/staff-access/requests",
          bearer: agent.requesterKey,
          body: requestBody({
            scopes: [scope as "copy:source" | "copy:target"],
            organization: organization.slug,
            counterpartOrganization: other.slug,
          }),
        });
        const requestId = String(created.body.requestId);
        await w.approve({
          choice: { requestId, spendApproved: false, typedOrganizationName: organization.name },
        });
        const redeemed = await send({
          method: "POST",
          path: `/api/staff-access/requests/${requestId}/redeem`,
          bearer: agent.requesterKey,
          body: { codeVerifier: VERIFIER },
        });
        expect(redeemed.body.apiKey).toBeUndefined();
        return String(redeemed.body.opsToken);
      };
      const sourceToken = await side(ACME, GLOBEX, "copy:source");
      const targetToken = await side(GLOBEX, ACME, "copy:target");
      const secretOf = (token: string) => token.split("_").at(-1) ?? token;

      const dryRun = await send({
        method: "POST",
        path: "/api/staff-access/ops/copies",
        bearer: targetToken,
        body: { sourceOpsToken: sourceToken, dryRun: true },
      });
      const malformed = await send({
        method: "POST",
        path: "/api/staff-access/ops/copies",
        bearer: targetToken,
        body: { sourceOpsToken: sourceToken, dryRun: "yes" },
      });
      const unknown = await send({
        method: "POST",
        path: "/api/staff-access/ops/copies",
        bearer: targetToken,
        body: { sourceOpsToken: `${sourceToken}x` },
      });

      expect(dryRun).toMatchObject({ status: 200, body: { dryRun: true, stoppedBecause: null } });
      expect(malformed.status).toBeGreaterThanOrEqual(400);
      expect(unknown).toMatchObject({ status: 401, body: { code: "staff_copy_source_invalid" } });
      const trail = await Promise.all(
        (await w.app.overview(w.operator("user_olivia"))).sessions.map((session) =>
          w.repositories.events.findByRequest({ requestId: session.requestId }),
        ),
      );
      const written = JSON.stringify([dryRun, malformed, unknown, trail, w.state.audit]);
      expect(written).not.toContain(secretOf(sourceToken));
    });
  });

  describe("when the surface is off", () => {
    /** @scenario "The surface is hidden unless cloud ops and the flag are both on" */
    it("answers 404 not_found to a requester key", async () => {
      const { w, send } = mount();
      const agent = await w.enrol();
      w.state.flag = false;

      await expect(
        send({
          method: "POST",
          path: "/api/staff-access/requests",
          bearer: agent.requesterKey,
          body: requestBody({ scopes: ["ops:read"] }),
        }),
      ).resolves.toMatchObject({ status: 404, body: { code: "not_found" } });
    });
  });

  describe("when a requester key reaches for the ops allowlist", () => {
    it("refuses it as hidden", async () => {
      const { w, send } = mount();
      const agent = await w.enrol();

      const answer = await send({
        path: "/api/staff-access/ops/organizations",
        bearer: agent.requesterKey,
      });
      expect(answer.status).toBe(404);
    });
  });

  describe("when a request body is malformed", () => {
    /** @scenario "A request needs a valid shape" */
    it("refuses it and stores nothing", async () => {
      const { w, send } = mount();
      const agent = await w.enrol();

      const answer = await send({
        method: "POST",
        path: "/api/staff-access/requests",
        bearer: agent.requesterKey,
        body: { ...requestBody({ scopes: ["org:content"] }), organization: undefined },
      });
      expect(answer.status).toBeGreaterThanOrEqual(400);
      expect(answer.status).toBeLessThan(500);
      await expect(w.app.overview(w.operator("user_olivia"))).resolves.toMatchObject({
        sessions: [],
      });
    });
  });
});
