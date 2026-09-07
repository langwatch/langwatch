/**
 * @vitest-environment node
 *
 * The public auth surface has five unauthenticated, IP-limited entrances.
 * This source-shape guard keeps all of them on the shared trusted-proxy
 * resolver. The resolver suite exercises the networking policy itself.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routerSource = (name: "auth" | "user") =>
  readFileSync(join(__dirname, "..", `${name}.ts`), "utf8");

function trustedClientKeyPattern(scope: string): RegExp {
  const escapedScope = scope.replaceAll(".", "\\.");
  return new RegExp(
    String.raw`const peerIp = getAuthRateLimitClientIp\(ctx\.req\) \?\? "unknown";[\s\S]{0,1800}?key: \`${escapedScope}:\$\{peerIp\}\``,
  );
}

describe("public auth rate-limit client identity", () => {
  it.each([
    "auth.route",
    "auth.requestSignUpVerification",
    "auth.inviteLanding",
    "auth.requestFreshInvite",
  ])("keys %s on the trusted-proxy-aware client", (scope) => {
    expect(routerSource("auth")).toMatch(trustedClientKeyPattern(scope));
  });

  it("keys user registration on the trusted-proxy-aware client", () => {
    expect(routerSource("user")).toMatch(
      trustedClientKeyPattern("user.register"),
    );
  });

  it("does not retain direct-peer-only auth call sites", () => {
    expect(routerSource("auth")).not.toContain("getDirectPeerIp");
    expect(routerSource("user")).not.toContain("getDirectPeerIp");
  });
});
