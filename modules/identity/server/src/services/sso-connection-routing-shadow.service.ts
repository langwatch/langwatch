import {
  compareConnectionRouting,
  type ConnectionRoutingComparison,
  type RoutableConnection,
} from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import type { SignInDomainRouting } from "./signin-router.service.ts";

const logger = createLogger("langwatch:identity:ssoconn-routing-shadow");

/**
 * `SSOCONN_ROUTING=shadow` (ADR-117 §5), as one port wrapping two.
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
  deciding: SignInDomainRouting;
  /** The port whose answer is only compared. In shadow that is the
   *  `SsoConnection` projection. */
  shadow: SignInDomainRouting;
  recorder?: SsoConnectionRoutingShadowRecorder;
}

export class ShadowComparingDomainRoutingAdapter implements SignInDomainRouting {
  static create(deps: SsoConnectionRoutingShadowDeps): ShadowComparingDomainRoutingAdapter {
    return new ShadowComparingDomainRoutingAdapter(deps);
  }

  private readonly deciding: SignInDomainRouting;
  private readonly shadow: SignInDomainRouting;
  private readonly recorder: SsoConnectionRoutingShadowRecorder;

  private constructor(deps: SsoConnectionRoutingShadowDeps) {
    this.deciding = deps.deciding;
    this.shadow = deps.shadow;
    this.recorder = deps.recorder ?? defaultRecorder;
  }

  async tryFindConnectionForDomain({
    domain,
  }: {
    domain: string;
  }): Promise<RoutableConnection | null> {
    const decided = await this.deciding.tryFindConnectionForDomain({ domain });
    await this.compare({
      lookup: "domain",
      domain,
      decided,
      read: () => this.shadow.tryFindConnectionForDomain({ domain }),
    });
    return decided;
  }

  /**
   * The no-address lookup.
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

function soleOf(connections: readonly RoutableConnection[]): RoutableConnection | null {
  return connections.length === 1 ? (connections[0] ?? null) : null;
}
