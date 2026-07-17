import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";

const { isEnabled, getPage } = vi.hoisted(() => ({
  isEnabled: vi.fn(),
  getPage: vi.fn(),
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    checkProjectPermission:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
  };
});

vi.mock("~/server/featureFlag", () => ({
  featureFlagService: { isEnabled },
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    langy: {
      conversations: { getPage },
    },
  }),
}));

import { langyRouter } from "../langy";

function callerFor(user: {
  id: string;
  email: string;
  emailVerified?: boolean;
}) {
  return langyRouter.createCaller(
    createInnerTRPCContext({
      session: { user, expires: "1" } as any,
      permissionChecked: false,
    }),
  );
}

describe("langyRouter rollout gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPage.mockResolvedValue({ items: [], nextCursor: null });
  });

  it("denies non-staff before reading Langy data when the flag is off", async () => {
    isEnabled.mockResolvedValue(false);

    await expect(
      callerFor({ id: "customer-1", email: "user@example.com" }).list({
        projectId: "project-1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(getPage).not.toHaveBeenCalled();
  });

  it("allows staff without consulting the rollout flag", async () => {
    await expect(
      callerFor({
        id: "staff-1",
        email: "aryan@langwatch.ai",
        emailVerified: true,
      }).list({ projectId: "project-1" }),
    ).resolves.toEqual({ items: [], nextCursor: null });

    expect(isEnabled).not.toHaveBeenCalled();
  });

  it("allows an explicitly flagged non-staff user", async () => {
    isEnabled.mockResolvedValue(true);

    await expect(
      callerFor({ id: "customer-2", email: "user@example.com" }).list({
        projectId: "project-1",
      }),
    ).resolves.toEqual({ items: [], nextCursor: null });

    expect(getPage).toHaveBeenCalledOnce();
  });
});
