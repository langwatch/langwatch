/**
 * The `/api/v1/organizations` instance-provisioning family: self-hosted only.
 */
import { resolveEndpoint } from "@/internal/endpoint";
import { createManagementRequest, type ManagementRequest } from "../_shared/management-request";

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

/**
 * The instance credential, or a refusal naming what to set.
 */
export const resolveInstanceAdminToken = ({ instanceKey }: { instanceKey?: string }): string => {
  const token = instanceKey ?? process.env[INSTANCE_ADMIN_KEY_ENV];
  if (!token) {
    throw new Error(
      `No instance administrator credential. Set ${INSTANCE_ADMIN_KEY_ENV} or pass instanceKey. This surface exists on self-hosted deployments only, and does not accept an organization API key.`,
    );
  }
  return token;
};

export class OrganizationsAdminApiService {
  readonly #request: ManagementRequest;

  constructor(config?: { endpoint?: string; instanceKey?: string }) {
    this.#request = createManagementRequest({
      endpoint: resolveEndpoint(config?.endpoint),
      token: resolveInstanceAdminToken({ instanceKey: config?.instanceKey }),
      errorFactory: ({ message, operation, body }) =>
        new OrganizationsAdminApiError(message, operation, body),
    });
  }

  async create(input: CreateOrganizationInput): Promise<CreatedOrganization> {
    return this.#request({
      operation: "create organization",
      path: "/api/v1/organizations",
      method: "POST",
      body: input,
    });
  }

  async list(): Promise<{
    organizations: ProvisionedOrganizationSummary[];
  }> {
    return this.#request({
      operation: "list organizations",
      path: "/api/v1/organizations",
    });
  }

  async get(id: string): Promise<{ organization: ProvisionedOrganizationSummary }> {
    return this.#request({
      operation: `fetch organization "${id}"`,
      path: `/api/v1/organizations/${encodeURIComponent(id)}`,
    });
  }
}
