import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import {
  type BackfillJsonObject,
  GatewayVirtualKeyConfigBackfillRepository,
  type MintGuardrailInput,
  type MintRoutingPolicyInput,
  type VirtualKeyRow,
} from "../gateway-virtual-key-config-backfill.repository";

/**
 * Exactly the delegate methods this walk calls, picked from the real client
 * rather than re-declared, so a typed `PrismaClient` satisfies it with no cast
 * and every row type comes from its own call site.
 */
type Delegate<Model extends keyof PrismaClient, Methods extends keyof PrismaClient[Model]> = Pick<
  PrismaClient[Model],
  Methods
>;

export type VirtualKeyConfigBackfillDatabase = {
  organization: Delegate<"organization", "findMany">;
  virtualKey: Delegate<"virtualKey", "findMany" | "update">;
  routingPolicy: Delegate<"routingPolicy", "create">;
  gatewayGuardrail: Delegate<"gatewayGuardrail", "create">;
};

const VIRTUAL_KEY_SELECT = {
  id: true,
  name: true,
  organizationId: true,
  routingPolicyId: true,
  config: true,
  scopes: { select: { scopeType: true, scopeId: true } },
} as const;

export class PrismaGatewayVirtualKeyConfigBackfillRepository extends GatewayVirtualKeyConfigBackfillRepository {
  private constructor(private readonly database: VirtualKeyConfigBackfillDatabase) {
    super();
  }

  static create(options: {
    database: VirtualKeyConfigBackfillDatabase;
  }): PrismaGatewayVirtualKeyConfigBackfillRepository {
    return new PrismaGatewayVirtualKeyConfigBackfillRepository(options.database);
  }

  async findOrganizationIds(): Promise<string[]> {
    const organizations = await this.database.organization.findMany({ select: { id: true } });
    return organizations.map((organization) => organization.id);
  }

  async findVirtualKeys({ organizationId }: { organizationId: string }): Promise<VirtualKeyRow[]> {
    const rows = await this.database.virtualKey.findMany({
      where: { organizationId },
      select: VIRTUAL_KEY_SELECT,
      orderBy: { createdAt: "asc" },
    });
    return rows as VirtualKeyRow[];
  }

  async mintRoutingPolicy(input: MintRoutingPolicyInput): Promise<string> {
    const created = await this.database.routingPolicy.create({
      data: {
        id: input.id,
        organizationId: input.organizationId,
        name: input.name,
        description: input.description,
        modelProviderIds: [],
        modelAliases: input.modelAliases,
        policyRules: input.policyRules as Prisma.InputJsonObject,
        scopes: {
          create: input.scopes.map((scope) => ({
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
          })),
        },
      },
    });
    return created.id;
  }

  async mintGuardrail(input: MintGuardrailInput): Promise<string> {
    const created = await this.database.gatewayGuardrail.create({ data: { ...input } });
    return created.id;
  }

  async updateVirtualKeyConfig({
    id,
    config,
    routingPolicyId,
  }: {
    id: string;
    config: BackfillJsonObject;
    routingPolicyId: string | null;
  }): Promise<void> {
    // `config` is a Json column and this object is assembled from one that was
    // read back, so it is narrowed to Prisma's input JSON at the write.
    await this.database.virtualKey.update({
      where: { id },
      data: { config: config as Prisma.InputJsonObject, routingPolicyId },
    });
  }
}
