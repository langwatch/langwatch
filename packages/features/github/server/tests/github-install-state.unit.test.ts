import { describe, expect, it } from "vitest";

import {
  signGithubInstallState,
  verifyGithubInstallState,
} from "../src/adapters/github.github-install-state.adapter";

describe("Github install state", () => {
  it("round-trips a signed payload", () => {
    const payload = {
      userId: "user-1",
      organizationId: "org-1",
      mode: "popup" as const,
      returnTo: "/settings/integrations#github",
      issuedAt: 1_700_000_000_000,
      nonce: "nonce-1",
      nonceRegistered: true,
    };
    const token = signGithubInstallState(payload, "test-key");
    expect(verifyGithubInstallState(token, "test-key", payload.issuedAt)).toEqual(
      payload,
    );
    expect(verifyGithubInstallState(token, "wrong-key", payload.issuedAt)).toBeNull();
  });
});
