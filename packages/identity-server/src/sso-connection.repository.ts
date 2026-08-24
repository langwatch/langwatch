import type { SsoConnectionState } from "@langwatch/identity";

/**
 * How the connection guards see current state (D04, ADR-117 §5): reads over
 * the `SsoConnection` projection. The app implements this with Prisma
 * (platform/app/src/server/app-layer/identity/repositories/sso-connection-reads.prisma.repository.ts).
 *
 * On the calling-path dispatch these reads are read-your-writes against
 * Postgres; on the staged path they run under the queue's per-connection
 * FIFO, which serializes them against the fold. Either way a guard reads the
 * folded state first and refuses on what it says.
 */
export interface SsoConnectionReadRepository {
  /** One connection's folded state, or null when it has no history yet. */
  findConnection(args: {
    connectionId: string;
  }): Promise<SsoConnectionState | null>;

  /**
   * The connection that already holds a domain as VERIFIED on an ACTIVE
   * connection — first verifier owns. The SCOPE of "already" is the
   * implementation's: global on SaaS, this instance on self-hosted. The
   * guard states the rule; where the rule reaches is a deployment fact and
   * belongs where the deployment is known.
   */
  findDomainOwner(args: {
    domain: string;
  }): Promise<{ connectionId: string; organizationId: string } | null>;
}

/**
 * Whether an organization holds a live break-glass binding right now — the
 * second half of activation's precondition (ADR-117 §5).
 *
 * D05 owns break-glass BINDINGS; they do not exist yet. This port is how the
 * requirement exists before they do: activation asks, and pre-D05 the
 * composed implementation answers from what the deployment can actually
 * prove — a local method the instance still mounts. When D05 lands, the
 * bindings become this port's answer and every activation is already asking.
 */
export interface SsoBreakGlassBindingRepository {
  hasLiveBinding(args: { organizationId: string }): Promise<boolean>;
}

/**
 * Who a teardown would strand: users whose only live sign-in identifiers
 * belong to this connection. Read over the identity heads — the `Identifier`
 * projection D01 built — because that is where "how can this person get in"
 * is answered, and teardown must not invent a second answer.
 */
export interface SsoConnectionStrandingRepository {
  findStrandedUserIds(args: { connectionId: string }): Promise<string[]>;
}
