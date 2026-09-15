import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserService } from "~/server/users/user.service";
import { createInnerTRPCContext } from "../../trpc";
import { userRouter } from "../user";

vi.mock("../../../../env.mjs", () => ({
  env: { NEXTAUTH_PROVIDER: "email", BASE_HOST: "http://localhost:5560" },
}));

vi.mock("~/server/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn().mockResolvedValue(void 0),
}));

describe("userRouter profile boundary", () => {
  const updateProfile = vi.spyOn(UserService.prototype, "updateProfile");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const caller = () =>
    userRouter.createCaller(
      createInnerTRPCContext({
        session: {
          user: { id: "ana", email: "ana@example.com", name: "Ana" },
          sessionId: "session-current",
          expires: "2099-01-01",
        },
      }),
    );

  /** @scenario "A blank name is refused at the boundary as well" */
  it("rejects a whitespace-only name before the profile writer is reached", async () => {
    await expect(caller().updateName({ name: "   " })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    expect(updateProfile).not.toHaveBeenCalled();
  });
});
