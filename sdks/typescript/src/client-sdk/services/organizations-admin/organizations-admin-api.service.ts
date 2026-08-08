/**
 * The `/api/organizations` instance-provisioning family: self-hosted only.
 *
 * The one management surface that exists before any organization does, so it
 * authenticates with the instance administrator credential
 * (`LANGWATCH_INSTANCE_ADMIN_API_KEY`) rather than an organization API key.
 * Creating an organization returns an organization-scoped admin key, which is
 * the credential every other management family then takes.
 *
 * A deployment with no instance credential configured, and every cloud
 * deployment, answers 404 on these paths: the family is absent, not forbidden.
 *
 * CLI-only, and deliberately not exported from the client SDK's public index.
 */
import { resolveEndpoint } from "@/internal/endpoint";
import {
  createManagementRequest,
  type ManagementRequest,
} from "../_shared/management-request";

export interface ProvisionedOrganizationSummary {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface CreatedOrganization {
  organization: { id: string; name: string; slug: string };
  team: { id: string; slug: string; name: string };
  /** The bootstrap credential. The token is returned once, here. */
  adminApiKey: { id: string; token: string };
}

export interface CreateOrganizationInput {
  name: string;
  /** The natural key. Derived from the name when omitted. */
  slug?: string;
  adminApiKeyName?: string;
}

export class OrganizationsAdminApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "OrganizationsAdminApiError";
  }
}

/** The environment variable the instance credential is read from. */
export const INSTANCE_ADMIN_KEY_ENV = "LANGWATCH_INSTANCE_ADMIN_API_KEY";

export class OrganizationsAdminApiService {
  readonly #request: ManagementRequest;

  constructor(config?: { endpoint?: string; instanceKey?: string }) {
    this.#request = createManagementRequest({
      endpoint: resolveEndpoint(config?.endpoint),
      // Deliberately NOT the organization key: this credential authenticates
      // against the instance, and falling back to LANGWATCH_API_KEY would send
      // an organization key to a surface that cannot accept one.
      token: config?.instanceKey ?? process.env[INSTANCE_ADMIN_KEY_ENV] ?? "",
      errorFactory: ({ message, operation, body }) =>
        new OrganizationsAdminApiError(message, operation, body),
    });
  }

  async create(input: CreateOrganizationInput): Promise<CreatedOrganization> {
    return this.#request({
      operation: "create organization",
      path: "/api/organizations",
      method: "POST",
      body: input,
    });
  }

  async list(): Promise<{
    organizations: ProvisionedOrganizationSummary[];
  }> {
    return this.#request({
      operation: "list organizations",
      path: "/api/organizations",
    });
  }

  async get(
    id: string,
  ): Promise<{ organization: ProvisionedOrganizationSummary }> {
    return this.#request({
      operation: `fetch organization "${id}"`,
      path: `/api/organizations/${encodeURIComponent(id)}`,
    });
  }
}
