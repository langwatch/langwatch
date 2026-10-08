/**
 * @vitest-environment node
 * Copy for the codes the sign-up form receives from the front door.
 */
import { describe, expect, it } from "vitest";

import { frontDoorErrorCopy } from "../front-door-error-copy.ts";

const copy = ({ code, meta = {} }: { code: string; meta?: Record<string, unknown> }) =>
  frontDoorErrorCopy({ code, httpStatus: 400, meta, tips: [], traceId: undefined });

describe("frontDoorErrorCopy for the sign-up form", () => {
  /** @scenario "The sign-up form explains a refused registration and a rate limit in its own words" */
  it("names the identity provider for auth_direct_registration_unavailable", () => {
    expect(copy({ code: "auth_direct_registration_unavailable" })).toEqual({
      title: "Accounts here are created by your identity provider",
      description:
        "Use the sign-in method your organization set up. Ask an administrator if you are not sure which one that is.",
    });
  });

  it.each([
    [undefined, "Wait a few minutes, then try again."],
    [30, "Wait a minute, then try again."],
    [61, "Wait 2 minutes, then try again."],
    ["300", "Wait a few minutes, then try again."],
  ])("counts down auth_rate_limited from %s seconds", (retryAfterSeconds, expected) => {
    const result = copy({ code: "auth_rate_limited", meta: { retryAfterSeconds } });
    expect(result).toEqual({ title: "Too many attempts", description: expected });
  });
});
