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

vi.mock("../../api/rbac", () => ({
  hasOrganizationPermission: (...args: unknown[]) =>
    hasOrganizationPermissionMock(...args),
  hasTeamPermission: (...args: unknown[]) => hasTeamPermissionMock(...args),
  hasProjectPermission: (...args: unknown[]) =>
    hasProjectPermissionMock(...args),
}));

import { MASKED_KEY_PLACEHOLDER } from "../../../utils/constants";
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

    /** @scenario "A test with nothing supplied uses what is stored" */
    it("probes the endpoint saved on the row when the call supplies none", async () => {
      findByIdForOrganizationMock.mockResolvedValueOnce(orgScopedRow());

      await service().testConnection({
        input: { modelProviderId: "mp_1", organizationId: ORGANIZATION_ID },
        ctx,
      });

      const [, keys] = validateProviderApiKeyMock.mock.calls[0]!;
      expect(keys.OPENAI_BASE_URL).toBe("https://saved.example.com/v1");
    });
  });

  describe("given settings supplied with the call", () => {
    /** @scenario "A test never sends a stored credential to an endpoint from the caller" */
    it("uses only what was supplied, never merging the stored credential in", async () => {
      // The whole security property in one assertion. A caller who can edit a
      // provider may never have been allowed to read its key; if an endpoint
      // they chose were filled in with a key out of storage, this server would
      // post that key wherever they liked, and permission to edit would have
      // become permission to extract.
      findByIdForOrganizationMock.mockResolvedValueOnce(orgScopedRow());

      await service().testConnection({
        input: {
          modelProviderId: "mp_1",
          organizationId: ORGANIZATION_ID,
          customKeys: {
            OPENAI_API_KEY: "sk-typed-just-now",
            OPENAI_BASE_URL: "https://attacker.example.com/v1",
          },
        },
        ctx,
      });

      const [, keys] = validateProviderApiKeyMock.mock.calls[0]!;
      expect(keys).toEqual({
        OPENAI_API_KEY: "sk-typed-just-now",
        OPENAI_BASE_URL: "https://attacker.example.com/v1",
      });
      expect(JSON.stringify(keys)).not.toContain("sk-stored");
    });

    /** @scenario "Changing an endpoint without the credential asks for the credential" */
    it("keeps the stored credential out of it when the supplied one is masked", async () => {
      // What the drawer sends when someone edits an endpoint without
      // re-entering the key. The masked sentinel is not a credential, so the
      // check does not run — and the stored key stays where it is rather than
      // being substituted in behind the customer's back.
      findByIdForOrganizationMock.mockResolvedValueOnce(orgScopedRow());
      validateProviderApiKeyMock.mockResolvedValueOnce({
        outcome: "unchecked",
        valid: true,
        reason: "credential_masked",
      });

      const result = await service().testConnection({
        input: {
          modelProviderId: "mp_1",
          organizationId: ORGANIZATION_ID,
          customKeys: {
            OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
            OPENAI_BASE_URL: "https://attacker.example.com/v1",
          },
        },
        ctx,
      });

      const [, keys] = validateProviderApiKeyMock.mock.calls[0]!;
      expect(keys.OPENAI_API_KEY).toBe(MASKED_KEY_PLACEHOLDER);
      expect(JSON.stringify(keys)).not.toContain("sk-stored");
      expect(result.outcome).toBe("unchecked");
    });

    it("still refuses a caller who cannot manage the row", async () => {
      // Supplying settings does not route around the row: it is still looked
      // up and still scope-checked. The budget is deliberately not reached —
      // a caller who cannot manage the row is refused rather than throttled,
      // so their attempt never spends the organization's allowance.
      findByIdForOrganizationMock.mockResolvedValueOnce(orgScopedRow());
      hasOrganizationPermissionMock.mockResolvedValue(false);

      await expect(
        service().testConnection({
          input: {
            modelProviderId: "mp_1",
            organizationId: ORGANIZATION_ID,
            customKeys: { OPENAI_API_KEY: "sk-typed-just-now" },
          },
          ctx,
        }),
      ).rejects.toBeInstanceOf(ModelProviderScopeForbiddenError);

      expect(validateProviderApiKeyMock).not.toHaveBeenCalled();
      expect(rateLimitMock).not.toHaveBeenCalled();
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

  describe("when the credential has only been typed in", () => {
    /** @scenario "Repeated checks are limited however they are made" */
    it("counts a typed credential against the same budget as a stored one", async () => {
      // Two routes to the same outbound request, and only one of them used to
      // be counted. That was survivable while the typed-credential route was
      // reachable only by saving — a refusal there arms a gate that skips the
      // next probe, so a person could not sit on it. A control that checks
      // without saving removes both bounds at once.
      rateLimitMock.mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 30_000,
      });

      await expect(
        service().validateCredential({
          input: {
            organizationId: ORGANIZATION_ID,
            provider: "openai",
            customKeys: { OPENAI_API_KEY: "sk-typed-just-now" },
          },
          ctx,
        }),
      ).rejects.toBeInstanceOf(ModelProviderTestRateLimitedError);

      expect(validateProviderApiKeyMock).not.toHaveBeenCalled();
    });

    it("shares one budget with the stored-credential route", async () => {
      await service().validateCredential({
        input: {
          organizationId: ORGANIZATION_ID,
          provider: "openai",
          customKeys: { OPENAI_API_KEY: "sk-typed-just-now" },
        },
        ctx,
      });

      // The same keys, so a caller cannot double their allowance by
      // alternating between the two ways of asking.
      const keys = rateLimitMock.mock.calls.map(([opts]: any[]) => opts.key);
      expect(keys).toEqual([
        `model-provider-test:org:${ORGANIZATION_ID}`,
        "model-provider-test:global",
      ]);
    });

    it("checks exactly the credential it was handed", async () => {
      await service().validateCredential({
        input: {
          organizationId: ORGANIZATION_ID,
          provider: "openai",
          customKeys: { OPENAI_API_KEY: "sk-typed-just-now" },
        },
        ctx,
      });

      expect(validateProviderApiKeyMock).toHaveBeenCalledWith("openai", {
        OPENAI_API_KEY: "sk-typed-just-now",
      });
    });

    it("refuses to spend the budget of an organization the caller cannot manage", async () => {
      // The organization handle is a value the caller chose, and it is the
      // rate-limit key. Unchecked, naming someone else's organization spends
      // their allowance — which both supplies the caller with an endless run
      // of fresh buckets and denies the real owner a control they are entitled
      // to. Nothing goes out, and nothing is counted.
      hasOrganizationPermissionMock.mockResolvedValue(false);

      await expect(
        service().validateCredential({
          input: {
            organizationId: "org_someone_else",
            provider: "openai",
            customKeys: { OPENAI_API_KEY: "sk-typed-just-now" },
          },
          ctx,
        }),
      ).rejects.toBeInstanceOf(ModelProviderScopeForbiddenError);

      expect(rateLimitMock).not.toHaveBeenCalled();
      expect(validateProviderApiKeyMock).not.toHaveBeenCalled();
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
