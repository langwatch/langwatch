import type { RoutableConnection } from "@langwatch/identity";
import type { SignInDomainRoutingPort } from "@langwatch/identity-server";

/**
 * Which of the two domain lookups decides a sign-in (D09 — see
 * specs/identity/sso-idp-termination.feature).
 *
 * D04 shipped the flip as an environment variable, and an
 * environment variable is a fleet-wide decision. D09 replaced it with a
 * per-organization feature flag, which was the right grain and the wrong
 * control: it asked an administrator to turn their connection on and then
 * asked somebody they have never met to turn a second thing on before anybody
 * was sent through it. A connection reading "on" while it carried nobody is
 * not a rollout state, it is a screen disagreeing with itself.
 *
 * TURNING THE CONNECTION ON IS THE DECISION, so there is no second switch to
 * consult. A connection that has been turned on answers for its domains, and
 * that answer is taken at its word.
 *
 * A CONNECTION THAT DECIDES NOTHING MUST NOT PRE-EMPT THE COLUMNS THAT DO.
 * The projection deliberately answers for EVERY lifecycle state, because a
 * SUSPENDED connection still owns its domain and the engine has a branch to
 * say so. Routing needs a narrower question than ownership: which states
 * actually reach a branch in `routeSignIn`. Only ACTIVE and SUSPENDED do —
 * every other state falls through it. So taking a non-null answer as the end
 * of the lookup meant an organization with working legacy single sign-on
 * that merely STARTED registering a connection, and proved its domain, got a
 * VERIFIED row that suppressed the legacy answer and matched no branch:
 * everybody there quietly stopped being sent to their identity provider,
 * mid-setup, before anything had been activated. The rollout switch that
 * used to hide this is gone, so it would have been every such customer.
 *
 * The legacy columns keep every domain the projection does not DECIDE for —
 * every organization that never registered a connection, and every one whose
 * connection is not yet carrying sign-ins.
 */

/** The lifecycle states `routeSignIn` has a branch for. A connection in any
 *  other state has no answer to give, and must let the legacy lookup speak
 *  rather than silencing it. */
const ROUTING_STATES: readonly string[] = ["ACTIVE", "SUSPENDED"];
export class ConnectionFirstDomainRoutingRepository
  implements SignInDomainRoutingPort
{
  constructor(
    private readonly deps: {
      legacy: SignInDomainRoutingPort;
      connections: SignInDomainRoutingPort;
    },
  ) {}

  async findConnectionForDomain({
    domain,
  }: {
    domain: string;
  }): Promise<RoutableConnection | null> {
    const projected = await this.deps.connections.findConnectionForDomain({
      domain,
    });
    if (projected !== null && ROUTING_STATES.includes(projected.state)) {
      return projected;
    }
    return this.deps.legacy.findConnectionForDomain({ domain });
  }

  /**
   * The self-hosted sole-connection rule's input.
   *
   * Union rather than either-or, and deliberately: this list answers "is
   * there exactly one place everybody here signs in", and an installation
   * part-way through registering connections has one whichever side it is
   * currently listed from. Answering only the legacy side would make a
   * registered connection invisible to the rule; answering only the
   * projection would make an unregistered one disappear from it. Duplicates
   * are removed by connection id, so an organization listed on both sides
   * still counts once.
   */
  async listActiveConnections(): Promise<readonly RoutableConnection[]> {
    const [legacy, projected] = await Promise.all([
      this.deps.legacy.listActiveConnections(),
      this.deps.connections.listActiveConnections(),
    ]);
    const seen = new Set(projected.map((one) => one.connectionId));
    return [
      ...projected,
      ...legacy.filter((one) => !seen.has(one.connectionId)),
    ];
  }
}
