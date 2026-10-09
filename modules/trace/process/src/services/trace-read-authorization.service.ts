import type { Actor, Authorization } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";

/** The permission every proof a trace read carries is minted under (ADR-175). */
const TRACE_READ_PERMISSION = "traces:view";

type CompiledFilter = { sql: string; params: Record<string, unknown> };

/** The authorized-reads repository's fragment expansion: markers into the proof's fence. */
type FragmentExpander = {
  expandFragment(input: {
    authorization: Authorization;
    filterWhere: CompiledFilter;
  }): CompiledFilter;
};

/**
 * ADR-175: the sealed proofs Trace's reads are fenced by, minted through authz. Nothing below
 * evaluates a permission again: the store client applies whatever the proof names.
 */
export class TraceReadAuthorizationService {
  static create({
    authz,
    reads,
  }: {
    authz: Pick<AuthzApi, "mintAuthorization" | "mintInternalAuthorization">;
    reads: FragmentExpander;
  }): TraceReadAuthorizationService {
    return new TraceReadAuthorizationService(authz, reads);
  }

  private constructor(
    private readonly authz: Pick<AuthzApi, "mintAuthorization" | "mintInternalAuthorization">,
    private readonly reads: FragmentExpander,
  ) {}

  /**
   * The proof for a route's caller on one project: their own grant in full plus one shared grant
   * per project shared with it, so an aggregate reads its members. Platform callers get the
   * own-only proof, since a shared grant is never theirs.
   */
  forCaller({
    actor,
    projectId,
    route,
  }: {
    actor: Actor;
    projectId: string;
    route: string;
  }): Promise<Authorization> {
    const purpose = { kind: "route", route } as const;
    switch (actor.type) {
      case "user":
        return this.authz.mintAuthorization({
          actor,
          principal: { type: "user", id: actor.id },
          permission: TRACE_READ_PERMISSION,
          scope: { projectId },
          purpose,
        });
      case "api_key":
        return this.authz.mintAuthorization({
          actor,
          principal: { type: "apiKey", id: actor.id },
          permission: TRACE_READ_PERMISSION,
          scope: { projectId },
          purpose,
        });
      case "system":
      case "internal":
        return this.authz.mintInternalAuthorization({
          actor,
          projectId,
          permission: TRACE_READ_PERMISSION,
          purpose,
        });
    }
  }

  /**
   * The own-only proof for a read whose caller was admitted some other way (a share link, a
   * peer module, a background refresh). It fences the read to `projectId` alone and widens
   * through no grant, so an aggregate id reads its own empty tenant.
   */
  ownOnly({ projectId, entry }: { projectId: string; entry: string }): Promise<Authorization> {
    return this.authz.mintInternalAuthorization({
      actor: { type: "internal", codePath: `modules/trace/process:${entry}` },
      projectId,
      permission: TRACE_READ_PERMISSION,
      purpose: { kind: "operator", entry },
    });
  }

  /**
   * A compiled filter's markers expanded into `projectId`'s own fence, for a read that assembles
   * its own statement and names its own tenant (the legacy search). Own-only, so the fence's
   * tenant set is exactly the one tenant that read declares to the tenant guard.
   */
  async expandForOwnProject({
    projectId,
    entry,
    filterWhere,
  }: {
    projectId: string;
    entry: string;
    filterWhere: { sql: string; params: Record<string, unknown> };
  }): Promise<{ sql: string; params: Record<string, unknown> }> {
    const authorization = await this.ownOnly({ projectId, entry });
    return this.reads.expandFragment({ authorization, filterWhere });
  }
}
