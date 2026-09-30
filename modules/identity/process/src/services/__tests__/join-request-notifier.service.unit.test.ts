import { JoinRequestNotFoundError } from "@langwatch/identity-contract";
import { describe, expect, it, vi } from "vitest";

import type { JoinRequestNotificationMail } from "../../app/identity.members.ts";
import type { JoinRequestAudienceRepository } from "../../repositories/join-request-audience.repository.ts";
import type { JoinRequestNotificationContextRepository } from "../../repositories/join-request-notification-context.repository.ts";
import { JoinRequestNotifierService } from "../join-request-notifier.service.ts";

/**
 * Spec: modules/identity/specs/join-request-worker-composition.feature
 */

function recordingMail() {
  const sendRequestArrived = vi.fn(
    async (_: Parameters<JoinRequestNotificationMail["sendRequestArrived"]>[0]) => undefined,
  );
  const sendRequestExpired = vi.fn(
    async (_: Parameters<JoinRequestNotificationMail["sendRequestExpired"]>[0]) => undefined,
  );
  const sendJoinedAutomatically = vi.fn(
    async (_: Parameters<JoinRequestNotificationMail["sendJoinedAutomatically"]>[0]) => undefined,
  );
  class RecordingMail implements JoinRequestNotificationMail {
    sendRequestArrived = sendRequestArrived;
    async sendRequestStillWaiting(): Promise<unknown> {
      return undefined;
    }
    async sendRequestApproved(): Promise<unknown> {
      return undefined;
    }
    async sendRequestRejected(): Promise<unknown> {
      return undefined;
    }
    sendRequestExpired = sendRequestExpired;
    sendJoinedAutomatically = sendJoinedAutomatically;
  }
  return {
    mail: new RecordingMail(),
    sendRequestArrived,
    sendRequestExpired,
    sendJoinedAutomatically,
  };
}

function fakeAudience(): JoinRequestAudienceRepository {
  return {
    getRequesterId: vi.fn(async () => {
      throw new JoinRequestNotFoundError("no such request");
    }),
    getOrganizationName: vi.fn(async () => "Acme Corp"),
    findAdmins: vi.fn(async () => [{ userId: "user_priya", email: "priya@acme.example" }]),
    getUserProfile: vi.fn(async () => ({ name: "Morgan Ellis", email: "morgan@acme.example" })),
  };
}

function fakeContext(
  overrides: Partial<JoinRequestNotificationContextRepository> = {},
): JoinRequestNotificationContextRepository {
  return {
    getOrganizationIntent: vi.fn(async () => ({ primaryIntent: null })),
    countApprovedFromDomain: vi.fn(async () => 0),
    findPersonalTeamSlugs: vi.fn(async () => []),
    ...overrides,
  };
}

describe("JoinRequestNotifierService", () => {
  describe("when a request arrives from a domain with prior approvals", () => {
    /** @scenario "The arrival notifier counts prior approvals from the domain" */
    it("passes the approved-from-domain count to the mail", async () => {
      const recording = recordingMail();
      const audience = fakeAudience();
      const context = fakeContext({ countApprovedFromDomain: vi.fn(async () => 3) });
      const adapter = JoinRequestNotifierService.create({
        audience,
        context,
        mail: recording.mail,
        baseHost: "https://app.langwatch.ai",
      });

      await adapter.requestArrived({
        joinRequestId: "joinreq_1",
        organizationId: "organization_acme",
        requesterUserId: "user_morgan",
        domain: "acme.example",
      });

      expect(recording.sendRequestArrived).toHaveBeenCalledWith(
        expect.objectContaining({ approvedFromDomainCount: 3 }),
      );
    });
  });

  describe("when a notice reaches two administrators", () => {
    /** @scenario "Each join-request mail carries a delivery key naming its notice and its recipient" */
    it("gives each administrator's mail its own delivery key, the same on a resend", async () => {
      const recording = recordingMail();
      const audience = fakeAudience();
      audience.findAdmins = vi.fn(async () => [
        { userId: "user_priya", email: "priya@acme.example" },
        { userId: "user_sam", email: "sam@acme.example" },
      ]);
      const adapter = JoinRequestNotifierService.create({
        audience,
        context: fakeContext(),
        mail: recording.mail,
        baseHost: "https://app.langwatch.ai",
      });
      const notice = {
        joinRequestId: "joinreq_1",
        organizationId: "organization_acme",
        requesterUserId: "user_morgan",
        domain: "acme.example",
      };

      await adapter.requestArrived(notice);
      await adapter.requestArrived(notice);

      const keys = recording.sendRequestArrived.mock.calls.map(([sent]) => sent.idempotencyKey);
      expect(keys[0]).toBe(
        "joinRequestLifecycle:organization_acme:join:joinreq_1:requestArrived:user_priya",
      );
      expect(keys[0]).not.toBe(keys[1]);
      expect(keys.slice(2)).toEqual(keys.slice(0, 2));
    });
  });

  describe("when a lapsed requester already holds a personal project", () => {
    /** @scenario "The expiry notifier finds the requester's own personal project" */
    it("passes the personal project link to the mail", async () => {
      const recording = recordingMail();
      const audience = fakeAudience();
      const context = fakeContext({
        findPersonalTeamSlugs: vi.fn(async () => ["personal-morgan-ellis"]),
      });
      const adapter = JoinRequestNotifierService.create({
        audience,
        context,
        mail: recording.mail,
        baseHost: "https://app.langwatch.ai",
      });

      await adapter.requestExpired({
        joinRequestId: "joinreq_1",
        organizationId: "organization_acme",
        requesterUserId: "user_morgan",
      });

      expect(recording.sendRequestExpired).toHaveBeenCalledWith(
        expect.objectContaining({
          personalProjectUrl: "https://app.langwatch.ai/personal-morgan-ellis",
        }),
      );
    });
  });

  describe("when a lapsed requester holds no personal project", () => {
    /** @scenario "The expiry notifier finds the requester's own personal project" */
    it("omits the personal project link", async () => {
      const recording = recordingMail();
      const audience = fakeAudience();
      const context = fakeContext();
      const adapter = JoinRequestNotifierService.create({
        audience,
        context,
        mail: recording.mail,
        baseHost: "https://app.langwatch.ai",
      });

      await adapter.requestExpired({
        joinRequestId: "joinreq_1",
        organizationId: "organization_acme",
        requesterUserId: "user_morgan",
      });

      const sent = recording.sendRequestExpired.mock.calls[0]?.[0];
      expect(sent?.personalProjectUrl).toBeUndefined();
    });
  });

  describe("when the plan and membership census are composed", () => {
    /** @scenario "The auto-join notifier reads the same seat census as invitations" */
    it("passes the seat census to the domain-auto-joined mail", async () => {
      const recording = recordingMail();
      const audience = fakeAudience();
      const context = fakeContext();
      const plans = {
        getActivePlan: vi.fn(async () => ({ maxMembers: 5, planSource: "subscription" })),
      };
      const memberships = { getMemberCount: vi.fn(async () => 4) };
      const adapter = JoinRequestNotifierService.create({
        audience,
        context,
        mail: recording.mail,
        baseHost: "https://app.langwatch.ai",
        plans,
        memberships,
      });

      await adapter.joinedAutomatically({
        joinRequestId: "joinreq_1",
        organizationId: "organization_acme",
        requesterUserId: "user_morgan",
        domain: "acme.example",
      });

      expect(recording.sendJoinedAutomatically).toHaveBeenCalledWith(
        expect.objectContaining({ seats: { used: 4, ceiling: 5 } }),
      );
    });
  });

  describe("when the organization is on a negotiated plan", () => {
    /** @scenario "The auto-join notifier reads the same seat census as invitations" */
    it("omits the seat census", async () => {
      const recording = recordingMail();
      const audience = fakeAudience();
      const context = fakeContext();
      const plans = {
        getActivePlan: vi.fn(async () => ({ maxMembers: 1000, planSource: "license" })),
      };
      const memberships = { getMemberCount: vi.fn(async () => 4) };
      const adapter = JoinRequestNotifierService.create({
        audience,
        context,
        mail: recording.mail,
        baseHost: "https://app.langwatch.ai",
        plans,
        memberships,
      });

      await adapter.joinedAutomatically({
        joinRequestId: "joinreq_1",
        organizationId: "organization_acme",
        requesterUserId: "user_morgan",
        domain: "acme.example",
      });

      const sent = recording.sendJoinedAutomatically.mock.calls[0]?.[0];
      expect(sent?.seats).toBeUndefined();
    });
  });
});
