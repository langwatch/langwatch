/**
 * @vitest-environment node
 *
 * The acting user's GitHub-login-like handle for bot-authored attribution comes
 * from the LangWatch profile only (never a GitHub call), sanitised to the GitHub
 * username charset so the Co-authored-by trailer is always well-formed.
 */
import { describe, expect, it } from "vitest";

import { resolveActingGithubLogin } from "../LangyCredentialService";
import type { Session } from "~/server/auth";

function session(user: Record<string, unknown>): Session {
  return { user: { id: "u1", ...user }, expires: "1" } as unknown as Session;
}

describe("resolveActingGithubLogin", () => {
  it("uses the profile name, sanitised to the GitHub username charset", () => {
    expect(resolveActingGithubLogin(session({ name: "Ada Lovelace" }))).toBe(
      "ada-lovelace",
    );
  });

  it("falls back to the email local-part when there is no name", () => {
    expect(
      resolveActingGithubLogin(session({ email: "ada@example.com" })),
    ).toBe("ada");
  });

  it("falls back to a stable handle when nothing usable is present", () => {
    expect(resolveActingGithubLogin(session({}))).toBe("langwatch-user");
  });

  it("never emits leading/trailing dashes or illegal characters", () => {
    const handle = resolveActingGithubLogin(session({ name: "  @@Bob!!  " }));
    expect(handle).toBe("bob");
  });
});
