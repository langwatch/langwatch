import type { Actor, Authorization } from "@langwatch/authorization";
import type { AuthzApi, AuthzPrincipalRef } from "@langwatch/authz-contract";

type ProofAuthz = Pick<AuthzApi, "getScope" | "authorize">;

/**
 * The asker's traces:view proof for a trace read behind an analytics:* route, minted the way the
 * door mints one (api-door.service.ts #mintProof); a refusal throws (ruling TRACE-PROOF-EVAL-PERM).
 */
export class InstantEvalTraceProofService {
  private constructor(private readonly authz: ProofAuthz) {}

  static create({ authz }: { authz: ProofAuthz }): InstantEvalTraceProofService {
    return new InstantEvalTraceProofService(authz);
  }

  async mint({
    projectId,
    actor,
    route,
  }: {
    projectId: string;
    actor: Actor;
    route: string;
  }): Promise<Authorization> {
    const scope = await this.authz.getScope({ projectId });
    if (scope.type !== "project") throw new Error(`${projectId} resolved to no project`);

    const { authorization } = await this.authz.authorize({
      principal: principalOf(actor),
      permission: "traces:view",
      scope,
      proof: { actor, purpose: { kind: "route", route } },
    });
    if (!authorization) throw new Error("authz minted no proof for a project read");

    return authorization;
  }
}

function principalOf(actor: Actor): AuthzPrincipalRef {
  if (actor.type === "user") return { type: "user", id: actor.id };
  if (actor.type === "api_key") return { type: "apiKey", id: actor.id };
  throw new Error(`a ${actor.type} actor cannot ask for a trace-read proof`);
}
