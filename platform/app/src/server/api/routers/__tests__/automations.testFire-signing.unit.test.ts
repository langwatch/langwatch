/**
 * @vitest-environment node
 *
 * A saved webhook automation's signing secret is used only with its saved URL.
 * Signing a draft pointed elsewhere would hand valid signatures to whoever
 * controls that URL, so the test fire is refused, as kept header values are.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appPermissionsService } from "~/test-utils/appPermissionsMock";
import { globalForApp } from "../../../app-layer/app";
import { createTestApp } from "../../../app-layer/presets";

const { mockTestFire, mockProjectGetById, mockTriggerGetById } = vi.hoisted(
  () => ({
    mockTestFire: vi.fn(),
    mockProjectGetById: vi.fn(),
    mockTriggerGetById: vi.fn(),
  }),
);

vi.mock("@ee/audit-log/auditLog", () => ({ auditLog: vi.fn() }));

vi.mock("~/utils/encryption", () => ({
  encrypt: (value: string) => `enc(${value})`,
  decrypt: (value: string) => value.replace(/^enc\(/, "").replace(/\)$/, ""),
}));

vi.mock(
  "~/server/app-layer/authz/permission-adapters",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("~/server/app-layer/authz/permission-adapters")
      >();
    return {
      ...actual,
      resolveProjectPermission: vi
        .fn()
        .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
    };
  },
);

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

const SAVED_URL = "https://receiver.example.com/hook";

const createTestCaller = () =>
  automationRouter.createCaller({
    session: {
      user: { id: "user_test_123", email: "owner@langwatch.test" },
      expires: "2099-01-01",
    },
    req: undefined,
    res: undefined,
    prisma: {},
    permissionChecked: false,
    publiclyShared: false,
    organizationRole: undefined,
  } as never);

const fireAt = (url: string) =>
  createTestCaller().testFireTemplate({
    projectId: "proj_123",
    channel: "webhook",
    trigger: { name: "Error spike", alertType: null },
    draft: {},
    webhook: null,
    webhookDestination: { url },
    automationId: "automation-1",
  });

describe("automationRouter.testFireTemplate signing", () => {
  let previousApp: typeof globalForApp.__langwatch_app;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTestFire.mockResolvedValue({
      channel: "webhook",
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
    mockTriggerGetById.mockResolvedValue({
      id: "automation-1",
      projectId: "proj_123",
      actionParams: { url: SAVED_URL, signingSecretEncrypted: "enc(whsec_1)" },
    });
    previousApp = globalForApp.__langwatch_app;
    globalForApp.__langwatch_app = createTestApp({
      permissions: appPermissionsService(),
      triggerTemplates: { testFire: mockTestFire } as never,
      projects: { getById: mockProjectGetById } as never,
      triggers: { getById: mockTriggerGetById } as never,
    });
  });

  afterEach(() => {
    globalForApp.__langwatch_app = previousApp;
  });

  describe("when the draft keeps the saved URL", () => {
    it("signs with the stored secret", async () => {
      await fireAt(SAVED_URL);

      expect(mockTestFire).toHaveBeenCalledWith(
        expect.objectContaining({
          webhookDestination: expect.objectContaining({
            url: SAVED_URL,
            signingSecrets: ["whsec_1"],
          }),
        }),
      );
    });
  });

  describe("when the draft points at a different URL", () => {
    /** @scenario "A test fire at a changed URL is not signed with the stored secret" */
    it("refuses and sends nothing", async () => {
      await expect(
        fireAt("https://attacker.example.net/collect"),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("Save the new destination URL"),
      });
      expect(mockTestFire).not.toHaveBeenCalled();
    });
  });
});
