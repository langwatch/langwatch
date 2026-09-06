import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { EmailJoinRequestNotifierAdapter } from "../postgres.join-request.adapter";
import { JoinRequestNotificationMailPort } from "../../ports/join-request-notification-mail.port";

/**
 * Spec: packages/features/identity/specs/join-request-worker-composition.feature
 */

function recordingMail() {
  const sendRequestArrived = vi.fn(
    async (_: Parameters<JoinRequestNotificationMailPort["sendRequestArrived"]>[0]) => undefined,
  );
  const sendRequestExpired = vi.fn(
    async (_: Parameters<JoinRequestNotificationMailPort["sendRequestExpired"]>[0]) => undefined,
  );
  const sendJoinedAutomatically = vi.fn(
    async (_: Parameters<JoinRequestNotificationMailPort["sendJoinedAutomatically"]>[0]) =>
      undefined,
  );
  class RecordingMail extends JoinRequestNotificationMailPort {
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

function fakePrisma(overrides: Record<string, unknown>): PrismaClient {
  return {
    organization: { findUnique: vi.fn(async () => ({ name: "Acme Corp" })) },
    organizationUser: {
      findMany: vi.fn(async () => [{ user: { email: "priya@acme.example" } }]),
    },
    user: {
      findUnique: vi.fn(async () => ({ name: "Morgan Ellis", email: "morgan@acme.example" })),
    },
    joinRequest: { count: vi.fn(async () => 0) },
    team: { findFirst: vi.fn(async () => null) },
    ...overrides,
  } as unknown as PrismaClient;
}

describe("EmailJoinRequestNotifierAdapter", () => {
  describe("when a request arrives from a domain with prior approvals", () => {
    /** @scenario "The arrival notifier counts prior approvals from the domain" */
    it("passes the approved-from-domain count to the mail", async () => {
      const recording = recordingMail();
      const prisma = fakePrisma({ joinRequest: { count: vi.fn(async () => 3) } });
      const adapter = EmailJoinRequestNotifierAdapter.create({
        prisma,
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

  describe("when a lapsed requester already holds a personal project", () => {
    /** @scenario "The expiry notifier finds the requester's own personal project" */
    it("passes the personal project link to the mail", async () => {
      const recording = recordingMail();
      const prisma = fakePrisma({
        team: { findFirst: vi.fn(async () => ({ slug: "personal-morgan-ellis" })) },
      });
      const adapter = EmailJoinRequestNotifierAdapter.create({
        prisma,
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
      const prisma = fakePrisma({});
      const adapter = EmailJoinRequestNotifierAdapter.create({
        prisma,
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
      const prisma = fakePrisma({});
      const plans = {
        getActivePlan: vi.fn(async () => ({ maxMembers: 5, planSource: "subscription" })),
      };
      const memberships = { getMemberCount: vi.fn(async () => 4) };
      const adapter = EmailJoinRequestNotifierAdapter.create({
        prisma,
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
      const prisma = fakePrisma({});
      const plans = {
        getActivePlan: vi.fn(async () => ({ maxMembers: 1000, planSource: "license" })),
      };
      const memberships = { getMemberCount: vi.fn(async () => 4) };
      const adapter = EmailJoinRequestNotifierAdapter.create({
        prisma,
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
