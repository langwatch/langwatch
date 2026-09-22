import type { RoutableConnection, SignInMethod } from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { legacySsoDialOf } from "../../rules/legacy-sso-dial.rules.ts";
import type { SignInDomainRouting } from "../../services/signin-router.service.ts";

/**
 * The router's domain-lookup port, over the data that exists TODAY: `Organization.ssoDomain` /
 * `ssoProvider`, two staff-set strings.
 * are on, so the swap is a line in `runtime.ts` (ADR-117 §1, §5).
 */
export class LegacySsoDomainRoutingRepository implements SignInDomainRouting {
  static create({
    prisma,
    instanceMethod,
  }: {
    prisma: PrismaClient;
    instanceMethod: () => Promise<SignInMethod | null>;
  }): LegacySsoDomainRoutingRepository {
    return new LegacySsoDomainRoutingRepository(prisma, instanceMethod);
  }

  constructor(
    private readonly prisma: PrismaClient,
    /** The method this deployment actually mounted, or null in email mode.
     *  Injected rather than read here so this class holds no policy. */
    private readonly instanceMethod: () => Promise<SignInMethod | null>,
  ) {}

  async tryFindConnectionForDomain({
    domain,
  }: {
    domain: string;
  }): Promise<RoutableConnection | null> {
    const organization = await this.prisma.organization.findUnique({
      where: { ssoDomain: domain },
      select: { id: true, ssoProvider: true },
    });
    if (!organization?.ssoProvider) return null;

    // An org PINS a provider and the deployment mounts one: dialable means
    // some mounted method carries the pin, which `legacySsoDialOf` reads and
    // which is the id handed out — the pin itself is not always something the
    // sign-in surface can dial. Where nothing carries it the router falls back
    // to the local set rather than redirecting somewhere that cannot answer.
    const mounted = await this.instanceMethod();
    const dial = legacySsoDialOf({
      pin: organization.ssoProvider,
      mountedMethodId: mounted?.id ?? null,
    });
    return {
      connectionId: `org:${organization.id}`,
      method: {
        id: dial.dialable ? dial.methodId : organization.ssoProvider,
        kind: "federated",
        connectionId: `org:${organization.id}`,
      },
      state: "ACTIVE",
      configured: dial.dialable,
      allowsJit: true,
    };
  }

  async listActiveConnections(): Promise<readonly RoutableConnection[]> {
    const method = await this.instanceMethod();
    if (!method) return [];
    return [
      {
        connectionId: `env:${method.id}`,
        method: { ...method, connectionId: `env:${method.id}` },
        state: "ACTIVE",
        configured: true,
        allowsJit: true,
      },
    ];
  }
}
