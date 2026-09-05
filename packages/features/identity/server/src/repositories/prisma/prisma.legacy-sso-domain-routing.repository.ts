import type { RoutableConnection, SignInMethod } from "@langwatch/identity-contract";
import type { SignInDomainRoutingPort } from "../../signin-router.service";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

/**
 * The router's domain-lookup port, over the data that exists TODAY: `Organization.ssoDomain` /
 * `ssoProvider`, two staff-set strings.
 * are on, so the swap is a line in `runtime.ts` (ADR-117 §1, §5).
 */
export class LegacySsoDomainRoutingRepository implements SignInDomainRoutingPort {
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

    // Pre-D04 an org names a provider but the deployment mounts one IdP, so a
    // connection is only dialable when the two agree. Where they disagree the
    // router falls back to the local set with `method_not_configured` rather
    // than redirecting somewhere that cannot answer.
    const mounted = await this.instanceMethod();
    return {
      connectionId: `org:${organization.id}`,
      method: {
        id: organization.ssoProvider,
        kind: "federated",
        connectionId: `org:${organization.id}`,
      },
      state: "ACTIVE",
      configured: mounted?.id === organization.ssoProvider,
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
