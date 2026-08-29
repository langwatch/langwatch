import { describe, expect, it } from "vitest";
import {
  type AuthzMigrationDatabase,
  PrismaAuthzMigrationRepository,
} from "../prisma.authz-migration.repository";

type Row = Record<string, any>;

class StubFindManyDelegate {
  readonly calls: unknown[] = [];

  constructor(private readonly rows: Row[] = []) {}

  async findMany(args: unknown): Promise<Row[]> {
    this.calls.push(args);
    return this.rows;
  }
}

class StubFindUniqueDelegate {
  constructor(private readonly row: Row | null = null) {}

  async findUnique(_args: unknown): Promise<Row | null> {
    return this.row;
  }
}

class StubGrantUsageDelegate extends StubFindManyDelegate {
  readonly creates: unknown[] = [];
  readonly updates: unknown[] = [];

  constructor(
    rows: Row[] = [],
    private readonly updateError?: unknown,
  ) {
    super(rows);
  }

  async createMany(args: unknown): Promise<unknown> {
    this.creates.push(args);
    return { count: 1 };
  }

  async update(args: unknown): Promise<unknown> {
    this.updates.push(args);
    if (this.updateError !== undefined) throw this.updateError;
    return {};
  }
}

class StubAuthzMigrationDatabase implements AuthzMigrationDatabase {
  readonly organization = new StubFindUniqueDelegate();
  readonly roleBinding: StubFindManyDelegate;
  readonly customRole = new StubFindManyDelegate();
  readonly organizationUser = new StubFindManyDelegate();
  readonly grant: StubFindManyDelegate;
  readonly role = new StubFindManyDelegate();
  readonly teamUser = new StubFindManyDelegate();
  readonly groupMembership = new StubFindManyDelegate();
  readonly project = new StubFindManyDelegate();
  readonly shareLink = new StubFindManyDelegate();
  readonly grantUsage: StubGrantUsageDelegate;

  constructor(
    options: {
      bindings?: Row[];
      grants?: Row[];
      usages?: Row[];
      updateError?: unknown;
    } = {},
  ) {
    this.roleBinding = new StubFindManyDelegate(options.bindings);
    this.grant = new StubFindManyDelegate(options.grants);
    this.grantUsage = new StubGrantUsageDelegate(options.usages, options.updateError);
  }
}

describe("PrismaAuthzMigrationRepository", () => {
  it("maps generated persistence values into the migration row contract", async () => {
    const database = new StubAuthzMigrationDatabase({
      bindings: [
        {
          id: "binding_1",
          userId: "user_1",
          groupId: null,
          apiKeyId: null,
          role: "MEMBER",
          customRoleId: null,
          scopeType: "PROJECT",
          scopeId: "project_1",
          createdAt: new Date(1_700_000_000_000),
        },
      ],
    });
    const repository = PrismaAuthzMigrationRepository.create(database);

    await expect(
      repository.findLegacyBindingRows({ organizationId: "org_1" }),
    ).resolves.toEqual([
      {
        id: "binding_1",
        userId: "user_1",
        groupId: null,
        apiKeyId: null,
        role: "MEMBER",
        customRoleId: null,
        scopeType: "PROJECT",
        scopeId: "project_1",
        createdAtMs: 1_700_000_000_000,
      },
    ]);
  });

  it("joins resource usage and treats a missing usage row as zero", async () => {
    const database = new StubAuthzMigrationDatabase({
      grants: [
        {
          id: "grant_1",
          source: "migration",
          token: "token_1",
          resourceKind: "TRACE",
          scopeId: "trace_1",
          projectId: "project_1",
          principalType: "ANYONE",
          principalId: null,
          expiresAt: null,
          maxViews: 10,
        },
        {
          id: "grant_2",
          source: "migration",
          token: "token_2",
          resourceKind: "TRACE",
          scopeId: "trace_2",
          projectId: "project_1",
          principalType: "ANYONE",
          principalId: null,
          expiresAt: null,
          maxViews: null,
        },
      ],
      usages: [{ grantId: "grant_1", viewCount: 7 }],
    });
    const repository = PrismaAuthzMigrationRepository.create(database);

    const rows = await repository.findResourceGrantRows({
      organizationId: "org_1",
    });

    expect(rows.map(({ grantId, viewCount }) => ({ grantId, viewCount }))).toEqual([
      { grantId: "grant_1", viewCount: 7 },
      { grantId: "grant_2", viewCount: 0 },
    ]);
  });

  it("persists missing budgets and safely ignores a failed guarded raise", async () => {
    const database = new StubAuthzMigrationDatabase({
      updateError: { code: "P2025" },
    });
    const repository = PrismaAuthzMigrationRepository.create(database);

    await expect(
      repository.seedResourceGrantUsage({
        organizationId: "org_1",
        seeds: [{ grantId: "grant_1", projectId: "project_1", viewCount: 4 }],
      }),
    ).resolves.toBeUndefined();

    expect(database.grantUsage.creates).toEqual([
      {
        data: [
          {
            grantId: "grant_1",
            organizationId: "org_1",
            projectId: "project_1",
            viewCount: 4,
          },
        ],
        skipDuplicates: true,
      },
    ]);
    expect(database.grantUsage.updates).toEqual([
      {
        where: {
          grantId: "grant_1",
          organizationId: "org_1",
          projectId: "project_1",
          viewCount: { lt: 4 },
        },
        data: { viewCount: 4 },
      },
    ]);
  });
});
