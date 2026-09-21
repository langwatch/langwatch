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
   * connection — first verifier owns. The SCOPE of "already" (global on
   * SaaS, instance-only on self-hosted) is a deployment fact, not this guard's.
   */
  abstract tryFindDomainOwner(args: {
    domain: string;
  }): Promise<{ connectionId: string; organizationId: string } | null>;

  /**
   * Every connection an organization holds, newest first. The read a peer
   * module is answered from: nobody outside identity queries these rows.
   */
  abstract findForOrganization(args: { organizationId: string }): Promise<SsoConnectionState[]>;
}

/**
 * Whether an organization holds a live break-glass binding — activation's
 * second precondition (ADR-117 §5). D05 owns these bindings; until it lands,
 * this port answers from what the deployment can prove today.
 */
export abstract class SsoBreakGlassBindingRepository {
  abstract hasLiveBinding(args: { organizationId: string }): Promise<boolean>;
}

/**
 * Whether an actor is a LangWatch PLATFORM operator (D05 amendment). A port,
 * not a wire boolean — a caller-supplied "I am an operator" would be the
 * caller authorizing itself, and self-hosted has platform operators too.
 */
export abstract class SsoPlatformOperatorRepository {
  abstract isPlatformOperator(args: { actorId: string }): Promise<boolean>;
}

/**
 * Who a teardown would strand: users whose only live sign-in identifiers
 * belong to this connection. Reads the `Identifier` projection (D01) —
 * teardown must not invent a second answer to "how can this person get in".
 */
export abstract class SsoConnectionStrandingRepository {
  abstract findStrandedUserIds(args: { connectionId: string }): Promise<string[]>;
}
