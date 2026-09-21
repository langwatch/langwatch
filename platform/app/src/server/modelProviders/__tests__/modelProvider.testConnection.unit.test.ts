import { beforeEach, describe, expect, it, vi } from "vitest";

const findByIdForOrganizationMock = vi.fn();
const findByProviderMock = vi.fn();
const validateProviderApiKeyMock = vi.fn();
const rateLimitMock = vi.fn();
const hasOrganizationPermissionMock = vi.fn();
const hasTeamPermissionMock = vi.fn();
const hasProjectPermissionMock = vi.fn();

vi.mock("../modelProvider.repository", () => ({
  ModelProviderRepository: class {
    findByIdForOrganization = findByIdForOrganizationMock;
    findByProvider = findByProviderMock;
  },
}));

vi.mock("../providerValidation", () => ({
  validateProviderApiKey: (...args: unknown[]) =>
    validateProviderApiKeyMock(...args),
}));

vi.mock("../../rateLimit", () => ({
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));

vi.mock("~/server/app-layer/permissions/imperative", () => ({
  probeOrganizationPermission: (...args: unknown[]) =>
    hasOrganizationPermissionMock(...args),
  probeTeamPermission: (...args: unknown[]) => hasTeamPermissionMock(...args),
  probeProjectPermission: (...args: unknown[]) =>
    hasProjectPermissionMock(...args),
}));

import {
  ModelProviderNotFoundError,
  ModelProviderScopeForbiddenError,
  ModelProviderTestRateLimitedError,
} from "../errors";
import { ModelProviderService } from "../modelProvider.service";

const ORGANIZATION_ID = "org_acme";

const ctx = {
  prisma: {} as any,
  session: { user: { id: "u_1" } } as any,
};

const service = () => ModelProviderService.create({} as any);

const orgScopedRow = (overrides: Record<string, unknown> = {}) => ({
  id: "mp_1",
  provider: "openai",
  organizationId: ORGANIZATION_ID,
  customKeys: {
    OPENAI_API_KEY: "sk-stored",
    OPENAI_BASE_URL: "https://saved.example.com/v1",
  },
  scopes: [{ scopeType: "ORGANIZATION", scopeId: ORGANIZATION_ID }],
  ...overrides,
});

/** Both budgets have room unless a test says otherwise. */
const budgetAvailable = () =>
  rateLimitMock.mockResolvedValue({
    allowed: true,
    remaining: 19,
    resetAt: Date.now() + 60_000,
  });

beforeEach(() => {
  findByIdForOrganizationMock.mockReset();
  findByProviderMock.mockReset();
  validateProviderApiKeyMock.mockReset();
  rateLimitMock.mockReset();
  hasOrganizationPermissionMock.mockReset();
  hasTeamPermissionMock.mockReset();
  hasProjectPermissionMock.mockReset();

  budgetAvailable();
  validateProviderApiKeyMock.mockResolvedValue({
    outcome: "verified",
    valid: true,
  });
  hasOrganizationPermissionMock.mockResolvedValue(true);
});

describe("testConnection", () => {
  describe("given a provider I can manage", () => {
    /** @scenario "Testing a saved provider uses the credential already stored" */
    it("sends the credential already stored, not one supplied with the call", async () => {
      findByIdForOrganizationMock.mockResolvedValueOnce(orgScopedRow());

      await service().testConnection({
        input: { modelProviderId: "mp_1", organizationId: ORGANIZATION_ID },
        ctx,
      });

      expect(validateProviderApiKeyMock).toHaveBeenCalledWith("openai", {
        OPENAI_API_KEY: "sk-stored",
        OPENAI_BASE_URL: "https://saved.example.com/v1",
      });
    });

    /** @scenario "A test never accepts an endpoint from the caller" */
    it("probes the endpoint saved on the row, with no way to name another", async () => {
      findByIdForOrganizationMock.mockResolvedValueOnce(orgScopedRow());

      // The call site has nowhere to put a destination: the input is a row id
      // and a tenant handle. This is the property that keeps a credential the
      // caller may never read from being posted somewhere they choose.
      await service().testConnection({
        input: {
          modelProviderId: "mp_1",
          organizationId: ORGANIZATION_ID,
          // @ts-expect-error — an endpoint is not part of the contract
          customBaseUrl: "https://attacker.example.com",
        },
        ctx,
      });

      const [, keys] = validateProviderApiKeyMock.mock.calls[0]!;
      expect(keys.OPENAI_BASE_URL).toBe("https://saved.example.com/v1");
      expect(JSON.stringify(keys)).not.toContain("attacker.example.com");
    });

    /** @scenario "Testing an organization-scoped provider reaches its credential" */
    it("finds a row granted at the organization scope", async () => {
      findByIdForOrganizationMock.mockResolvedValueOnce(orgScopedRow());

      const result = await service().testConnection({
        input: { modelProviderId: "mp_1", organizationId: ORGANIZATION_ID },
        ctx,
      });

      // The project-shaped lookup matches PROJECT grants only, so reaching for
      // it here would report a perfectly good org-scoped credential as absent.
      expect(findByIdForOrganizationMock).toHaveBeenCalledWith(
        "mp_1",
        ORGANIZATION_ID,
      );
      expect(findByProviderMock).not.toHaveBeenCalled();
      expect(result.outcome).toBe("verified");
    });
  });

  describe("given a row I am not allowed to act on", () => {
    /** @scenario "Testing a provider I cannot manage is refused" */
    it("refuses before the credential goes anywhere", async () => {
      findByIdForOrganizationMock.mockResolvedValueOnce(orgScopedRow());
      hasOrganizationPermissionMock.mockResolvedValue(false);

      await expect(
        service().testConnection({
          input: { modelProviderId: "mp_1", organizationId: ORGANIZATION_ID },
          ctx,
        }),
      ).rejects.toBeInstanceOf(ModelProviderScopeForbiddenError);

      expect(validateProviderApiKeyMock).not.toHaveBeenCalled();
    });

    /** @scenario "A provider row carrying no scopes is not testable" */
    it("treats a row granting no scopes as not found", async () => {
      // The per-scope gate iterates the scope list, so an empty list satisfies
      // it vacuously, and the org-anchored lookup has no scope predicate to
      // stop such a row being addressed by id. Without the scope-carrying
      // guard this is the shape that walks straight through.
      findByIdForOrganizationMock.mockResolvedValueOnce(
        orgScopedRow({ scopes: [] }),
      );

      await expect(
        service().testConnection({
          input: { modelProviderId: "mp_1", organizationId: ORGANIZATION_ID },
          ctx,
        }),
      ).rejects.toBeInstanceOf(ModelProviderNotFoundError);

      expect(validateProviderApiKeyMock).not.toHaveBeenCalled();
    });

    it("treats a row in another organization as not found", async () => {
      findByIdForOrganizationMock.mockResolvedValueOnce(null);

      await expect(
        service().testConnection({
          input: { modelProviderId: "mp_1", organizationId: ORGANIZATION_ID },
          ctx,
        }),
      ).rejects.toBeInstanceOf(ModelProviderNotFoundError);

      expect(validateProviderApiKeyMock).not.toHaveBeenCalled();
    });
  });

  describe("when the tests come too fast", () => {
    /** @scenario "Repeated tests are limited per organization" */
    it("stops asking once the organization has used its budget", async () => {
      findByIdForOrganizationMock.mockResolvedValueOnce(orgScopedRow());
      rateLimitMock.mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 30_000,
      });

      await expect(
        service().testConnection({
          input: { modelProviderId: "mp_1", organizationId: ORGANIZATION_ID },
          ctx,
        }),
      ).rejects.toBeInstanceOf(ModelProviderTestRateLimitedError);

      expect(validateProviderApiKeyMock).not.toHaveBeenCalled();
    });

    it("counts the organization before the instance, and both before asking", async () => {
      findByIdForOrganizationMock.mockResolvedValueOnce(orgScopedRow());

      await service().testConnection({
        input: { modelProviderId: "mp_1", organizationId: ORGANIZATION_ID },
        ctx,
      });

      const keys = rateLimitMock.mock.calls.map(([opts]: any[]) => opts.key);
      expect(keys).toEqual([
        `model-provider-test:org:${ORGANIZATION_ID}`,
        "model-provider-test:global",
      ]);
    });

    it("refuses a caller it cannot authorize rather than throttling them", async () => {
      // Ordering matters: a refusal that arrives as a rate limit tells a
      // caller their budget is the problem, and invites them to come back.
      findByIdForOrganizationMock.mockResolvedValueOnce(orgScopedRow());
      hasOrganizationPermissionMock.mockResolvedValue(false);

      await expect(
        service().testConnection({
          input: { modelProviderId: "mp_1", organizationId: ORGANIZATION_ID },
          ctx,
        }),
      ).rejects.toBeInstanceOf(ModelProviderScopeForbiddenError);

      expect(rateLimitMock).not.toHaveBeenCalled();
    });
  });

  describe("when the provider cannot be checked", () => {
    /** @scenario "A provider we cannot check says so instead of reporting success" */
    it("passes the unchecked verdict through rather than reporting a pass", async () => {
      findByIdForOrganizationMock.mockResolvedValueOnce(
        orgScopedRow({ provider: "bedrock" }),
      );
      validateProviderApiKeyMock.mockResolvedValueOnce({
        outcome: "unchecked",
        valid: true,
        reason: "provider_not_probeable",
      });

      const result = await service().testConnection({
        input: { modelProviderId: "mp_1", organizationId: ORGANIZATION_ID },
        ctx,
      });

      expect(result.outcome).toBe("unchecked");
    });
  });
});
