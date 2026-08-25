import type { AutomationDatabase } from "../../ports/automation-database.port";

type PrismaDelegate = {
  findFirst(args: unknown): Promise<unknown>;
  findMany(args: unknown): Promise<unknown[]>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
  deleteMany(args: unknown): Promise<{ count: number }>;
};

type PrismaTriggerSentDelegate = PrismaDelegate & {
  createMany(args: unknown): Promise<{ count: number }>;
  groupBy(args: unknown): Promise<unknown[]>;
};
type PrismaCustomGraphDelegate = {
  findUnique(args: unknown): Promise<unknown>;
  findMany(args: unknown): Promise<unknown[]>;
};

type PrismaClientShape = {
  project: Pick<PrismaDelegate, "findFirst">;
  trigger: PrismaDelegate;
  triggerSent: PrismaTriggerSentDelegate;
  emailSuppression: PrismaDelegate;
  customGraph: PrismaCustomGraphDelegate;
  webhookEndpointDelivery: Pick<PrismaDelegate, "create" | "findMany">;
  $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
};

/**
 * The only Prisma-client knowledge in the feature. The application passes its
 * already-created client as an opaque object; this private adapter narrows
 * only the delegates the repositories actually use.
 */
export class PrismaAutomationDatabaseRepository {
  private constructor(private readonly client: object) {}

  static create(client: object): PrismaAutomationDatabaseRepository {
    return new PrismaAutomationDatabaseRepository(client);
  }

  build(): AutomationDatabase {
    const prisma = this.client as PrismaClientShape;
    return {
      project: {
        findFirst: (args) => prisma.project.findFirst(args),
      },
      trigger: {
        findFirst: (args) => prisma.trigger.findFirst(args),
        findMany: (args) => prisma.trigger.findMany(args),
        findActiveReportTargets: () =>
          prisma.$queryRaw<
            Array<{ id: string; projectId: string; actionParams: unknown }>
          >`
						SELECT "id", "projectId", "actionParams"
						FROM "Trigger"
						WHERE "triggerKind" = 'REPORT'
						  AND "active" = true
						  AND "deleted" = false
						-- @tenancy: report-schedule reconciliation cross-tenant sweep (worker boot)
					`,
        create: (args) => prisma.trigger.create(args),
        update: (args) => prisma.trigger.update(args),
      },
      triggerSent: {
        create: (args) => prisma.triggerSent.create(args),
        createMany: (args) => prisma.triggerSent.createMany(args),
        findFirst: (args) => prisma.triggerSent.findFirst(args),
        findMany: (args) => prisma.triggerSent.findMany(args),
        groupBy: (args) => prisma.triggerSent.groupBy(args),
      },
      emailSuppression: {
        findFirst: (args) => prisma.emailSuppression.findFirst(args),
        findMany: (args) => prisma.emailSuppression.findMany(args),
        create: (args) => prisma.emailSuppression.create(args),
        deleteMany: (args) => prisma.emailSuppression.deleteMany(args),
      },
      customGraph: {
        findUnique: (args) => prisma.customGraph.findUnique(args),
        findMany: (args) => prisma.customGraph.findMany(args),
      },
      webhookEndpointDelivery: {
        create: (args) => prisma.webhookEndpointDelivery.create(args),
        findMany: (args) => prisma.webhookEndpointDelivery.findMany(args),
      },
      $queryRaw: (strings, ...values) => prisma.$queryRaw(strings, ...values),
      $executeRaw: (strings, ...values) => prisma.$executeRaw(strings, ...values),
    };
  }
}
