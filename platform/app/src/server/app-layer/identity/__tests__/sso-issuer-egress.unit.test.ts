/** @vitest-environment node */

/**
 * The issuer an operator types is an address this process later dials.
 *
 * `public-egress.ts` was written for exactly this and had no caller, which is
 * the worst state for a security control: it reads as active. This is the
 * caller, and these are the two answers it has to get right.
 *
 * Corresponds to specs/identity/sso-connection-lifecycle.feature.
 */
import { SsoConnectionIssuerNotPublicError } from "@langwatch/identity";
import { describe, expect, it, vi } from "vitest";
import { SsoConnectionBackofficeService } from "../sso-connection-backoffice.service";

const operator = { userId: "user_olive", email: "olive@langwatch.ai" };

function serviceResolving(addresses: string[]) {
  const registerConnection = vi.fn(async () => void 0);
  const service = new SsoConnectionBackofficeService({
    prisma: {} as never,
    connections: () => ({ registerConnection }) as never,
    resolveHost: async () => addresses,
  });
  return { service, registerConnection };
}

const registration = {
  organizationId: "org_acme",
  type: "oidc",
  providerId: "okta",
  allowsJit: false,
  operator: operator as never,
};

describe("registering a connection", () => {
  describe("when the issuer resolves inside our own network", () => {
    /** @scenario "An issuer that only answers on a private network is refused" */
    it("refuses it and registers nothing", async () => {
      const { service, registerConnection } = serviceResolving(["127.0.0.1"]);

      const attempt = service.registerConnection({
        ...registration,
        issuer: "https://idp.internal.example",
      });

      await expect(attempt).rejects.toBeInstanceOf(
        SsoConnectionIssuerNotPublicError,
      );
      // The refusal is worth nothing if the command still went out.
      expect(registerConnection).not.toHaveBeenCalled();
    });

    /** @scenario "An issuer that only answers on a private network is refused" */
    it("says nothing about what the name resolved to", async () => {
      const { service } = serviceResolving(["169.254.169.254"]);

      const attempt = service.registerConnection({
        ...registration,
        issuer: "https://metadata.example",
      });

      await expect(attempt).rejects.toSatisfy((error: unknown) => {
        const text = JSON.stringify({
          message: (error as Error).message,
          code: (error as { code?: string }).code,
        });
        return !text.includes("169.254");
      });
    });
  });

  describe("when the issuer resolves publicly", () => {
    it("registers the connection", async () => {
      const { service, registerConnection } = serviceResolving(["93.184.216.34"]);

      await service.registerConnection({
        ...registration,
        issuer: "https://idp.example.com",
      });

      expect(registerConnection).toHaveBeenCalledTimes(1);
    });
  });
});
