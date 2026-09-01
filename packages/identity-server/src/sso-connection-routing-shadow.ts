import {
  compareConnectionRouting,
  type ConnectionRoutingComparison,
  type RoutableConnection,
} from "@langwatch/identity";
import { createLogger } from "@langwatch/observability";
import type { SignInDomainRoutingPort } from "./signin-router.service";

const logger = createLogger("langwatch:identity:ssoconn-routing-shadow");

/**
 * `SSOCONN_ROUTING=shadow` (ADR-117 §5), as one port wrapping two.
 *
 * The strings keep deciding: every method returns the DECIDING port's answer,
 * unchanged, and the shadow port's answer is only ever compared and logged.
 * That is why this is a wrapper around `SignInDomainRoutingPort` rather than
 * anything inside the router — the engine, `SignInRouterService` and
 * `signInRouterShadow.ts` are untouched, and never learn that two lookups
 * ran. Flipping to `enforce` is composing the projection port on its own.
 *
 * The shadow leg cannot break a sign-in: its read runs in parallel, its
 * failures are caught here, and a comparison that could not be computed is
 * logged as such rather than counted as agreement. Silently counting an
 * unreadable projection as a match is how a bake gate lies.
 */

export interface SsoConnectionRoutingShadowRecorder {
  compared(record: SsoConnectionRoutingShadowRecord): void;
}

export interface SsoConnectionRoutingShadowRecord {
  /** The lookup that ran: a domain, or the no-address connection list. */
  lookup: "domain" | "active_connections";
  /** The domain compared; null for the connection-list lookup. */
  domain: string | null;
  comparison: ConnectionRoutingComparison | null;
  /** Set when the projection lookup itself failed. */
  error?: unknown;
}

const defaultRecorder: SsoConnectionRoutingShadowRecorder = {
  compared: (record) => {
    if (record.error) {
      logger.warn(
        { lookup: record.lookup, domain: record.domain, error: record.error },
        "sso connection routing shadow lookup failed; the string-based answer decided the sign-in",
      );
      return;
    }
    if (record.comparison && !record.comparison.matches) {
      logger.warn(
        {
          lookup: record.lookup,
          domain: record.domain,
          stringAnswer: record.comparison.legacy,
          connectionAnswer: record.comparison.connection,
        },
        "sso connection routing shadow mismatch: the connection projection and the legacy strings disagreed; the string-based answer decided the sign-in",
      );
    }
  },
};

export interface SsoConnectionRoutingShadowDeps {
  /** The port whose answer is returned. In shadow that is the strings. */
  deciding: SignInDomainRoutingPort;
  /** The port whose answer is only compared. In shadow that is the
   *  `SsoConnection` projection. */
  shadow: SignInDomainRoutingPort;
  recorder?: SsoConnectionRoutingShadowRecorder;
}

export class ShadowComparingDomainRoutingRepository
  implements SignInDomainRoutingPort
{
  private readonly deciding: SignInDomainRoutingPort;
  private readonly shadow: SignInDomainRoutingPort;
  private readonly recorder: SsoConnectionRoutingShadowRecorder;

  constructor(deps: SsoConnectionRoutingShadowDeps) {
    this.deciding = deps.deciding;
    this.shadow = deps.shadow;
    this.recorder = deps.recorder ?? defaultRecorder;
  }

  async findConnectionForDomain({
    domain,
  }: {
    domain: string;
  }): Promise<RoutableConnection | null> {
    const decided = await this.deciding.findConnectionForDomain({ domain });
    await this.compare({
      lookup: "domain",
      domain,
      decided,
      read: () => this.shadow.findConnectionForDomain({ domain }),
    });
    return decided;
  }

  /**
   * The no-address lookup. Only a self-hosted instance with exactly one
   * connection ever auto-redirects on it, so the comparison is over the sole
   * entry — a list of any other length routes nowhere either way, and
   * comparing element by element would report differences that decide
   * nothing.
   */
  async listActiveConnections(): Promise<readonly RoutableConnection[]> {
    const decided = await this.deciding.listActiveConnections();
    await this.compare({
      lookup: "active_connections",
      domain: null,
      decided: soleOf(decided),
      read: async () => soleOf(await this.shadow.listActiveConnections()),
    });
    return decided;
  }

  private async compare({
    lookup,
    domain,
    decided,
    read,
  }: {
    lookup: SsoConnectionRoutingShadowRecord["lookup"];
    domain: string | null;
    decided: RoutableConnection | null;
    read: () => Promise<RoutableConnection | null>;
  }): Promise<void> {
    try {
      const shadowed = await read();
      this.recorder.compared({
        lookup,
        domain,
        comparison: compareConnectionRouting({
          legacy: decided,
          connection: shadowed,
        }),
      });
    } catch (error) {
      this.recorder.compared({ lookup, domain, comparison: null, error });
    }
  }
}

function soleOf(
  connections: readonly RoutableConnection[],
): RoutableConnection | null {
  return connections.length === 1 ? (connections[0] ?? null) : null;
}
