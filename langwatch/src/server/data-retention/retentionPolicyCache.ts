import type { PrismaClient } from "@prisma/client";
import { TtlCache } from "../utils/ttlCache";
import type { RetentionPolicy, RetentionCategory } from "./retentionPolicy.schema";
import { retentionPolicySchema } from "./retentionPolicy.schema";
import { resolveRetentionDays } from "./resolveRetentionDays";
import type { RetentionPolicyResolver } from "./retentionPolicyResolver";

interface CachedRetentionData {
  projectPolicy: RetentionPolicy | null;
  orgPolicy: RetentionPolicy | null;
  resolved: RetentionPolicy;
}

export class RetentionPolicyCache implements RetentionPolicyResolver {
  private readonly cache: TtlCache<CachedRetentionData>;

  constructor(private readonly prisma: PrismaClient) {
    this.cache = new TtlCache(60_000, "retention-policy:");
  }

  async resolve(tenantId: string): Promise<RetentionPolicy | null> {
    const data = await this.loadPolicies(tenantId);
    return data.resolved;
  }

  async getRetentionDays(
    tenantId: string,
    category: RetentionCategory,
  ): Promise<number> {
    const data = await this.loadPolicies(tenantId);
    return data.resolved[category] ?? 0;
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId).catch(() => {});
  }

  private async loadPolicies(tenantId: string): Promise<CachedRetentionData> {
    const cached = await this.cache.get(tenantId);
    if (cached) return cached;

    const project = await this.prisma.project.findFirst({
      where: { id: tenantId },
      select: {
        retentionPolicy: true,
        team: {
          select: {
            organization: {
              select: { defaultRetentionPolicy: true },
            },
          },
        },
      },
    });

    const projectPolicy = parseRetentionPolicy(project?.retentionPolicy);
    const orgPolicy = parseRetentionPolicy(
      project?.team?.organization?.defaultRetentionPolicy,
    );

    const resolved: RetentionPolicy = {
      traces: resolveRetentionDays({ category: "traces", projectRetentionPolicy: projectPolicy, orgDefaultRetentionPolicy: orgPolicy }),
      scenarios: resolveRetentionDays({ category: "scenarios", projectRetentionPolicy: projectPolicy, orgDefaultRetentionPolicy: orgPolicy }),
      experiments: resolveRetentionDays({ category: "experiments", projectRetentionPolicy: projectPolicy, orgDefaultRetentionPolicy: orgPolicy }),
    };

    const result: CachedRetentionData = { projectPolicy, orgPolicy, resolved };
    await this.cache.set(tenantId, result);
    return result;
  }
}

function parseRetentionPolicy(raw: unknown): RetentionPolicy | null {
  if (raw == null) return null;
  const parsed = retentionPolicySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
