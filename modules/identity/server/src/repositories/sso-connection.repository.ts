import type { SsoConnectionState } from "@langwatch/identity-contract";

/**
 * How the connection guards see current state (D04, ADR-117 §5), reading the `SsoConnection`
 * projection: read-your-writes on the calling path, or serialized against the fold under the
 * queue's per-connection FIFO on the staged path. Either way a guard reads folded state first.
 */
export abstract class SsoConnectionReadRepository {
  /** One connection's folded state, or null when it has no history yet. */
  abstract tryFindConnection(args: { connectionId: string }): Promise<SsoConnectionState | null>;

  /**
   * The connection that already holds a domain as VERIFIED on an ACTIVE
   * connection — first verifier owns. The SCOPE of "already" is the
   * implementation's: global on SaaS, this instance on self-hosted. The
   * guard states the rule; where the rule reaches is a deployment fact and
   * belongs where the deployment is known.
   */
  abstract tryFindDomainOwner(args: {
    domain: string;
  }): Promise<{ connectionId: string; organizationId: string } | null>;
}

/**
 * Whether an organization holds a live break-glass binding right now — the second half of
 * activation's precondition (ADR-117 §5). D05 owns break-glass bindings, which don't exist yet;
 * this port is how the requirement exists before they do, answering from what the deployment can
 * prove today. When D05 lands, its bindings become this port's answer.
 */
export abstract class SsoBreakGlassBindingRepository {
  abstract hasLiveBinding(args: { organizationId: string }): Promise<boolean>;
}

/**
 * Whether an actor is a LangWatch PLATFORM operator, not an administrator of the organization
 * whose connection is being changed (D05 amendment). A port rather than a command field, because
 * a wire boolean saying "I am an operator" would be the caller authorizing itself; a port rather
 * than a deployment branch, because self-hosted installations have platform operators too.
 */
export abstract class SsoPlatformOperatorRepository {
  abstract isPlatformOperator(args: { actorId: string }): Promise<boolean>;
}

/**
 * Who a teardown would strand: users whose only live sign-in identifiers
 * belong to this connection. Read over the identity heads — the `Identifier`
 * projection D01 built — because that is where "how can this person get in"
 * is answered, and teardown must not invent a second answer.
 */
export abstract class SsoConnectionStrandingRepository {
  abstract findStrandedUserIds(args: { connectionId: string }): Promise<string[]>;
}
