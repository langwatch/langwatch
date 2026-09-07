/**
 * The request path every management family shares: what it does with a success
 * that carries no body, and what it refuses before a request is made.
 *
 * @see specs/typescript-sdk/cli-management-apis.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INSTANCE_ADMIN_KEY_ENV,
  OrganizationsAdminApiService,
} from "../../organizations-admin/organizations-admin-api.service";
import { createManagementRequest } from "../management-request";

let mockFetch: ReturnType<typeof vi.fn>;

const request = createManagementRequest({
  endpoint: "https://app.langwatch.ai",
  token: "test-key",
  errorFactory: ({ message }) => new Error(message),
});

beforeEach(() => {
  mockFetch = vi.fn();
  global.fetch = mockFetch as unknown as typeof fetch;
});

describe("createManagementRequest", () => {
  describe("when the family answers a success with no body", () => {
    /** @scenario A success carrying no body is not read as a parse failure */
    it("resolves rather than failing on the body it was never sent", async () => {
      // What `fetch` gives a 204: `json()` on an empty body throws, so a
      // helper that always parsed would turn a success into a parse failure.
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        },
      });

      await expect(
        request({
          operation: "revoke SCIM token",
          path: "/api/scim-tokens/scim_1",
          method: "DELETE",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the family answers a success with a JSON body", () => {
    it("returns the parsed document", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      await expect(
        request({ operation: "list custom roles", path: "/api/roles" }),
      ).resolves.toEqual({ success: true });
    });
  });
});

describe("OrganizationsAdminApiService", () => {
  const previous = process.env[INSTANCE_ADMIN_KEY_ENV];

  afterEach(() => {
    if (previous === undefined) delete process.env[INSTANCE_ADMIN_KEY_ENV];
    else process.env[INSTANCE_ADMIN_KEY_ENV] = previous;
  });

  describe("when no instance administrator credential is configured", () => {
    /** @scenario The instance family refuses to run without its credential */
    it("names the credential to set instead of sending an empty one", () => {
      delete process.env[INSTANCE_ADMIN_KEY_ENV];

      expect(() => new OrganizationsAdminApiService()).toThrow(
        new RegExp(INSTANCE_ADMIN_KEY_ENV),
      );
      // And nothing left for the platform to answer 404 to.
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("when the credential is passed rather than exported", () => {
    it("sends it as the bearer token", async () => {
      delete process.env[INSTANCE_ADMIN_KEY_ENV];
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ organizations: [] }),
      });

      await new OrganizationsAdminApiService({
        instanceKey: "instance-secret",
      }).list();

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(
        (init.headers as Record<string, string>).Authorization,
      ).toBe("Bearer instance-secret");
    });
  });
});
