import { ApiKeyPermissionDeniedError } from "@langwatch/api-key-contract";
import type { RestResolvedProjectCredential } from "@langwatch/api/rest";
import type { AuthzApi, AuthzPermission } from "@langwatch/authz-contract";
import {
  LangyApiRequestInvalidError,
  langyUiActionDispatchBodySchema,
  type LangyKeyCaller,
  type LangyUiActionDispatched,
  type LangyUiActionDispatchInput,
  type LangyUiActionsListed,
} from "@langwatch/langy-contract";

import type { LangyRestCallerService } from "./langy-rest-caller.service.ts";
import type { LangyUiActionCatalogService } from "./langy-ui-action-catalog.service.ts";
import type { LangyUiActionService } from "./langy-ui-action.service.ts";

/** A body that is not JSON reads as nothing, and nothing fails the dispatch schema by name. */
function parseDispatchBody(raw: string) {
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }
  const parsed = langyUiActionDispatchBodySchema.safeParse(json);
  if (!parsed.success) throw new LangyApiRequestInvalidError(parsed.error.issues);
  return parsed.data;
}

/**
 * The CLI's UI-action door: the surface's rollout (dark answers like an unmounted path), the
 * key's owner, then the named action's own permission as the key's ceiling — the browser path
 * runs under the person's full session, so it must never exceed what the worker's key holds.
 */
export class LangyUiActionDoorService {
  static create(deps: {
    callers: LangyRestCallerService;
    catalog: LangyUiActionCatalogService;
    authz: Pick<AuthzApi, "hasApiKeyPermission">;
    /** The channel, where this process has the Redis it runs on. */
    actions: LangyUiActionService | null;
  }): LangyUiActionDoorService {
    return new LangyUiActionDoorService(deps);
  }

  private constructor(
    private readonly deps: {
      callers: LangyRestCallerService;
      catalog: LangyUiActionCatalogService;
      authz: Pick<AuthzApi, "hasApiKeyPermission">;
      actions: LangyUiActionService | null;
    },
  ) {}

  async list(input: LangyKeyCaller): Promise<LangyUiActionsListed> {
    const caller = await this.deps.callers.getCaller({ ...input, surface: "ui_actions" });
    if (caller.dark) return { dark: true };
    return { dark: false, actions: this.deps.catalog.list() };
  }

  /** Unknown kinds refuse before the ceiling, so the error names the real problem. */
  async dispatch(input: LangyUiActionDispatchInput): Promise<LangyUiActionDispatched> {
    const caller = await this.deps.callers.getCaller({
      actor: input.actor,
      projectId: input.projectId,
      surface: "ui_actions",
    });
    if (caller.dark) return { dark: true };
    const { conversationId, kind, payload, experimentSlug } = parseDispatchBody(input.raw);
    const definition = this.deps.catalog.getByKind(kind);
    await this.assertCeiling({
      credential: input.credential,
      permission: definition.requiredPermission,
    });
    if (!this.deps.actions) throw new Error("Langy UI actions need this process's Redis");
    const outcome = await this.deps.actions.dispatch({
      projectId: caller.projectId,
      userId: caller.userId,
      conversationId,
      kind,
      payload: payload ?? {},
      ...(experimentSlug ? { experimentSlug } : {}),
    });
    return { dark: false, outcome };
  }

  /**
   * A legacy project key has no per-permission ceiling (it predates RBAC and carries full project
   * access by design); a scoped key must hold the action's permission.
   */
  private async assertCeiling({
    credential,
    permission,
  }: {
    credential: RestResolvedProjectCredential;
    permission: AuthzPermission;
  }): Promise<void> {
    if (credential.type !== "apiKey") return;
    const allowed = await this.deps.authz.hasApiKeyPermission({
      apiKeyId: credential.apiKeyId,
      userId: credential.userId,
      organizationId: credential.organizationId,
      scope: { type: "project", id: credential.project.id, teamId: credential.project.teamId },
      permission,
    });
    if (!allowed) throw new ApiKeyPermissionDeniedError(permission);
  }
}
