import type {
  SsoConnectionState,
  SsoDomainClaimQueueEntry,
} from "@langwatch/identity";

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

  /**
   * The connection an organization is setting up or running, or null when it
   * has none (D05 tiers 2 and 3).
   *
   * Singular because the self-serve surface is: an organization sets ONE
   * connection up itself, and offering to register a second before the first
   * routes anything would be offering a way to lock yourself out twice. The
   * back office, which does hold organizations with more than one, lists
   * them from its own read rather than through this port. A torn-down or
   * discarded connection is not one — it is a tombstone, and a customer
   * whose connection was removed is setting up from nothing again.
   */
  findConnectionForOrganization(args: {
    organizationId: string;
  }): Promise<SsoConnectionState | null>;
}

/**
 * The claims that still need a LangWatch operator, across every organization
 * — which is now the DISPUTED ones and nothing else.
 *
 * A published record decides an uncontested claim, so listing one would be
 * listing work nobody has to do; what a record cannot settle is two
 * organizations claiming the same domain, and that is what this answers.
 * Cross-organization by nature, twice over — the queue spans customers, and
 * deciding whether a claim is disputed means looking at another customer's
 * verified domains.
 *
 * Read-only: deciding a claim is one of the aggregate's guarded verbs, and
 * this port never writes. Longest-waiting first is the ordering, and the
 * wait itself is recorded on the claim rather than computed at read time,
 * because the epic's Open Q2 wants queue latency measured from the day the
 * queue exists and a number that only exists while a row is unread is not a
 * measurement.
 */
export interface SsoDomainClaimQueueRepository {
  findAllDisputed(args: {
    limit: number;
  }): Promise<SsoDomainClaimQueueEntry[]>;
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
 * Whether an actor is a LangWatch PLATFORM operator — not an administrator of
 * the organization whose connection is being changed, however many
 * permissions that organization can grant them (D05 amendment).
 *
 * A port rather than a field on the command, because a boolean on the wire
 * saying "I am an operator" is the caller authorizing itself. It is also a
 * port rather than a deployment branch: a self-hosted installation has
 * platform operators too, so the guard asks the same question everywhere and
 * the deployment answers it.
 */
export interface SsoPlatformOperatorRepository {
  isPlatformOperator(args: { actorId: string }): Promise<boolean>;
}

/**
 * Whether THIS INSTALLATION's enterprise licence can authorize a domain
 * claim (D05 tier 2).
 *
 * A port, and asked about the installation rather than about the actor,
 * because that is what a licence actually speaks for: a self-hosted customer
 * has nobody at LangWatch to reach, so their licence is the authorization
 * and it authorizes every organization on the instance they run. A hosted
 * deployment answers false to all of them — there is no instance licence to
 * speak with, and the claim queue is right there.
 *
 * The answer is the frozen startup one, exactly like ADR-027's gate: a
 * licence activated while the process is running is genuine and still does
 * not change what this process federates until it restarts.
 */
export interface SsoLicenseAuthorityRepository {
  /** True when the licence may stand in for a LangWatch operator's approval. */
  licenseAuthorizesDomainClaims(): Promise<boolean>;
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
