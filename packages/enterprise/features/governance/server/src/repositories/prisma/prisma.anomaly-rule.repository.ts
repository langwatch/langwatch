import type {
  Prisma,
  PrismaClient,
} from "@langwatch/prisma-client/generated";
import {
  anomalyRuleSchema,
  type AnomalyRule,
} from "@langwatch/enterprise-governance-contract";
import {
  AnomalyRuleRepository,
  type AnomalyRuleChanges,
  type NewAnomalyRule,
} from "../../ports/anomaly-rule.port";

export class PrismaAnomalyRuleRepository extends AnomalyRuleRepository {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create(database: object): PrismaAnomalyRuleRepository {
    return new PrismaAnomalyRuleRepository(database as PrismaClient);
  }

  async list(organizationId: string): Promise<AnomalyRule[]> {
    const rows = await this.prisma.anomalyRule.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: [{ severity: "asc" }, { name: "asc" }],
    });
    return rows.map(toAnomalyRule);
  }

  async tryFindById(id: string): Promise<AnomalyRule | null> {
    const row = await this.prisma.anomalyRule.findUnique({ where: { id } });
    return row ? toAnomalyRule(row) : null;
  }

  async create(input: NewAnomalyRule): Promise<AnomalyRule> {
    return toAnomalyRule(
      await this.prisma.anomalyRule.create({
        data: {
          ...input,
          thresholdConfig: input.thresholdConfig as Prisma.InputJsonValue,
          destinationConfig: input.destinationConfig as Prisma.InputJsonValue,
        },
      }),
    );
  }

  async update(
    id: string,
    changes: AnomalyRuleChanges,
  ): Promise<AnomalyRule> {
    const data: Prisma.AnomalyRuleUpdateInput = {};
    if (changes.name !== undefined) data.name = changes.name;
    if (changes.description !== undefined) {
      data.description = changes.description;
    }
    if (changes.severity !== undefined) data.severity = changes.severity;
    if (changes.ruleType !== undefined) data.ruleType = changes.ruleType;
    if (changes.scope !== undefined) data.scope = changes.scope;
    if (changes.scopeId !== undefined) data.scopeId = changes.scopeId;
    if (changes.status !== undefined) data.status = changes.status;
    if (changes.archivedAt !== undefined) {
      data.archivedAt = changes.archivedAt;
    }
    if (changes.thresholdConfig !== undefined) {
      data.thresholdConfig = changes.thresholdConfig as Prisma.InputJsonValue;
    }
    if (changes.destinationConfig !== undefined) {
      data.destinationConfig =
        changes.destinationConfig as Prisma.InputJsonValue;
    }
    return toAnomalyRule(
      await this.prisma.anomalyRule.update({ where: { id }, data }),
    );
  }
}

function toAnomalyRule(row: {
  id: string;
  organizationId: string;
  scope: string;
  scopeId: string;
  name: string;
  description: string | null;
  severity: string;
  ruleType: string;
  thresholdConfig: unknown;
  destinationConfig: unknown;
  status: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
}): AnomalyRule {
  return anomalyRuleSchema.parse(row);
}
