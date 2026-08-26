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
 * consult. The projection only ever answers for a connection that is live on
 * a domain it proved, and that answer is now taken at its word.
 *
 * The legacy columns keep every domain the projection does not answer for,
 * which is every organization that never registered a connection — their
 * sign-in is untouched, exactly as it was.
 */
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
    if (projected !== null) return projected;
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
