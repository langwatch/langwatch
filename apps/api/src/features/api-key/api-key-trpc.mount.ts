/**
 * App-process transport mount for the API-key vertical: the declared
 * `apiKey.*` transport on this process's runtime, plus the curated audit entry
 * each management write has always recorded.
 */

// The curated entry stays because the automatic row cannot say it: the generic
// redaction masks `apiKeyId` (the name matches the credential-field rule), and
// `revoke`'s answer carries no id — without it the trail could not say which
// key was retired. The minted token is never among its arguments, and the
// write is fire-and-forget, as this surface has always recorded it.

import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { apiKeyTrpcTransport } from "@langwatch/api-key-server";
import type { TrpcRuntime } from "@langwatch/api/trpc";

/** The one slice of the process context this namespace reads. */
export interface ApiKeyHostContext {
  app: Readonly<{ apiKeys: ApiKeyApi }>;
}

/** The process's audit trail, fire-and-forget. */
export type ApiKeyAuditSink = Readonly<{
  recordAudit(
    entry: Readonly<{
      userId: string;
      organizationId: string;
      action: string;
      args: Readonly<Record<string, unknown>>;
    }>,
  ): void;
}>;

/** Mounts `apiKey.*` on the app process's declared tRPC runtime. */
export function createApiKeyTrpcRouter<TContext extends ApiKeyHostContext>(
  mount: Readonly<{ runtime: TrpcRuntime<TContext> }> & ApiKeyAuditSink,
) {
  return mount.runtime.mount(apiKeyTrpcTransport, (ctx) =>
    withManagementAudit(ctx.app.apiKeys, mount.recordAudit),
  );
}

/**
 * The application slice, with the three management writes recording their
 * curated audit entry on success. A refusal records nothing here — the
 * automatic mutation row already carries the failure.
 */
function withManagementAudit(
  app: ApiKeyApi,
  recordAudit: ApiKeyAuditSink["recordAudit"],
): ApiKeyApi {
  const createKey: ApiKeyApi["createKey"] = async (input, by) => {
    const minted = await app.createKey(input, by);

    recordAudit({
      userId: by.id,
      organizationId: input.organizationId,
      action: "apiKey.create",
      args: {
        apiKeyId: minted.apiKey.id,
        name: input.name,
        keyType: input.keyType,
        permissionMode: input.permissionMode,
        assignedToUserId: minted.assignedToUserId,
      },
    });

    return minted;
  };

  const updateKey: ApiKeyApi["updateKey"] = async (input, by) => {
    const updated = await app.updateKey(input, by);

    recordAudit({
      userId: by.id,
      organizationId: input.organizationId,
      action: "apiKey.update",
      args: {
        apiKeyId: input.apiKeyId,
        name: input.name,
        permissionMode: input.permissionMode,
      },
    });

    return updated;
  };

  const revokeKey: ApiKeyApi["revokeKey"] = async (input, by) => {
    await app.revokeKey(input, by);

    recordAudit({
      userId: by.id,
      organizationId: input.organizationId,
      action: "apiKey.revoke",
      args: { apiKeyId: input.apiKeyId },
    });
  };

  // Every other member forwards untouched, bound to the app so its private
  // state survives the indirection.
  return new Proxy(app, {
    get(target, property) {
      if (property === "createKey") return createKey;
      if (property === "updateKey") return updateKey;
      if (property === "revokeKey") return revokeKey;

      const member: unknown = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
}
