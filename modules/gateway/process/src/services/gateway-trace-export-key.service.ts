/**
 * The key a gateway trace project's spans are exported with: ownerless, hidden, holding only
 * `traces:create`, minted once and never read from `Project.apiKey`. Its id moves the bundle's
 * ETag, so a replaced key reaches every pod on its next poll.
 */
import { type ApiKeyApi, TRACE_EXPORT_API_KEY_NAME } from "@langwatch/api-key-contract";

import type { GatewayTraceExportKeyRepository } from "../repositories/gateway-trace-export-key.repository.ts";

const TRACE_EXPORT_PERMISSIONS: readonly string[] = ["traces:create"];

export class GatewayTraceExportKeyService {
  private constructor(
    private readonly options: {
      repository: GatewayTraceExportKeyRepository;
      apiKeys: Pick<ApiKeyApi, "create">;
    },
  ) {}

  static create(options: {
    repository: GatewayTraceExportKeyRepository;
    apiKeys: Pick<ApiKeyApi, "create">;
  }): GatewayTraceExportKeyService {
    return new GatewayTraceExportKeyService(options);
  }

  /** The id of the project's key, or an empty list before its first bundle mints one. */
  async findKeyIds(projectId: string): Promise<string[]> {
    const stored = await this.options.repository.findForProject(projectId);
    return stored.map((key) => key.apiKeyId);
  }

  /** The project's export token, minted on first use. */
  async tokenFor(input: { organizationId: string; projectId: string }): Promise<string> {
    const [stored] = await this.options.repository.findForProject(input.projectId);
    if (stored) return stored.token;

    const { token, apiKey } = await this.options.apiKeys.create({
      isSystemManaged: true,
      name: TRACE_EXPORT_API_KEY_NAME,
      description: "Exports one project's gateway spans. Holds only traces:create.",
      userId: null,
      createdByUserId: null,
      organizationId: input.organizationId,
      permissionMode: "restricted",
      permissions: [...TRACE_EXPORT_PERMISSIONS],
      bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: input.projectId }],
    });
    // ponytail: a pod losing a concurrent first mint leaves its key unused;
    // a system revoke on ApiKeyApi would retire it.
    const kept = await this.options.repository.saveFirst({
      projectId: input.projectId,
      apiKeyId: apiKey.id,
      token,
    });
    return kept.token;
  }
}
