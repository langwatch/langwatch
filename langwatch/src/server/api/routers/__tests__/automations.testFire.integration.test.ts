/**
 * @vitest-environment node
 *
 * ADR-031 open-relay invariant: `testFireTemplate` must deliver a test email
 * ONLY to the requesting session user. The route resolves the recipient
 * server-side from `ctx.session.user.email` and ignores anything the client
 * supplies, so the historical "type any address, we'll mail it" open relay
 * stays closed. These tests drive the real router and assert the recipient
 * handed to the (mocked) mailer boundary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalForApp } from "../../../app-layer/app";
import { createTestApp } from "../../../app-layer/presets";

const { mockTestFire, mockProjectGetById } = vi.hoisted(() => ({
  mockTestFire: vi.fn(),
  mockProjectGetById: vi.fn(),
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    checkProjectPermission: vi.fn().mockImplementation(() => {
      return async ({ ctx, next }: any) =>
        next({ ctx: { ...ctx, permissionChecked: true } });
    }),
  };
});

// The session user IS the only legitimate recipient. Pin the rate-limit gate
// open so the recipient-forcing behaviour (not throttling) is what's under test.
// `automations.ts` imports rateLimit from `~/server/rateLimit`, three levels up
// from this __tests__ dir.
vi.mock("../../../rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../rateLimit")>();
  return {
    ...actual,
    rateLimit: vi
      .fn()
      .mockResolvedValue({ allowed: true, resetAt: Date.now() }),
  };
});

import { automationRouter } from "../automations";

const SESSION_EMAIL = "owner@langwatch.test";
const ATTACKER_EMAIL = "victim@elsewhere.test";

function createTestCaller(overrides?: { email?: string | null }) {
  const ctx = {
    session: {
      user: {
        id: "user_test_123",
        email:
          overrides && "email" in overrides ? overrides.email : SESSION_EMAIL,
      },
      expires: "2099-01-01",
    },
    req: undefined,
    res: undefined,
    prisma: {},
    permissionChecked: false,
    publiclyShared: false,
    organizationRole: undefined,
  } as any;

  return automationRouter.createCaller(ctx);
}

describe("automationRouter.testFireTemplate", () => {
  let previousApp: typeof globalForApp.__langwatch_app;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTestFire.mockResolvedValue({
      channel: "email",
      recipientCount: 1,
      usedDefault: true,
      missingVariables: [],
      errors: [],
    });
    mockProjectGetById.mockResolvedValue({
      id: "proj_123",
      name: "Acme",
      slug: "acme",
    });
    previousApp = globalForApp.__langwatch_app;
    globalForApp.__langwatch_app = createTestApp({
      triggerTemplates: { testFire: mockTestFire } as any,
      projects: { getById: mockProjectGetById } as any,
    });
  });

  afterEach(() => {
    globalForApp.__langwatch_app = previousApp;
  });

  describe("given an email test fire", () => {
    describe("when the client sends only the documented input", () => {
      it("forces the recipient to the authenticated session user", async () => {
        const caller = createTestCaller();

        await caller.testFireTemplate({
          projectId: "proj_123",
          channel: "email",
          trigger: { name: "High latency", alertType: null },
          draft: {},
          webhook: null,
        });

        expect(mockTestFire).toHaveBeenCalledTimes(1);
        const passed = mockTestFire.mock.calls[0]![0] as {
          recipients: string[];
        };
        expect(passed.recipients).toEqual([SESSION_EMAIL]);
      });
    });

    describe("when the client smuggles an extra recipient list", () => {
      it("ignores the client-supplied recipients and still mails only the session user", async () => {
        const caller = createTestCaller();

        // A hostile client attaches `recipients` / `members` / `to` fields the
        // ADR-031 schema no longer reads. The router must strip them and
        // resolve the recipient from the session, never from the wire — this is
        // the open-relay regression guard.
        await caller.testFireTemplate({
          projectId: "proj_123",
          channel: "email",
          trigger: { name: "High latency", alertType: null },
          draft: {},
          webhook: null,
          recipients: [ATTACKER_EMAIL],
          members: [ATTACKER_EMAIL],
          to: ATTACKER_EMAIL,
        } as any);

        expect(mockTestFire).toHaveBeenCalledTimes(1);
        const passed = mockTestFire.mock.calls[0]![0] as {
          recipients: string[];
        };
        expect(passed.recipients).toEqual([SESSION_EMAIL]);
        // The attacker-controlled address never reaches the mailer boundary.
        expect(passed.recipients).not.toContain(ATTACKER_EMAIL);
      });
    });

    describe("when the session user has no email address", () => {
      it("refuses to test-fire instead of mailing nobody (or anybody)", async () => {
        const caller = createTestCaller({ email: null });

        await expect(
          caller.testFireTemplate({
            projectId: "proj_123",
            channel: "email",
            trigger: { name: "High latency", alertType: null },
            draft: {},
            webhook: null,
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });

        expect(mockTestFire).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a slack test fire", () => {
    describe("when a webhook is supplied", () => {
      it("passes an empty recipient list (email recipients are email-only)", async () => {
        const caller = createTestCaller();
        mockTestFire.mockResolvedValue({
          channel: "slack",
          recipientCount: 1,
          usedDefault: true,
          missingVariables: [],
          errors: [],
        });

        await caller.testFireTemplate({
          projectId: "proj_123",
          channel: "slack",
          trigger: { name: "High latency", alertType: null },
          draft: {},
          webhook: "https://hooks.slack.com/services/T/B/X",
        });

        expect(mockTestFire).toHaveBeenCalledTimes(1);
        const passed = mockTestFire.mock.calls[0]![0] as {
          recipients: string[];
        };
        expect(passed.recipients).toEqual([]);
      });
    });
  });
});
