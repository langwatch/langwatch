import { describe, expect, it } from "vitest";

import {
  type AuthzMigrationDatabase,
  PrismaAuthzMigrationRepository,
} from "../prisma.authz-migration.repository.ts";

type Database = AuthzMigrationDatabase;
type RowOf<Delegate> = Delegate extends { findMany(args: unknown): Promise<(infer Row)[]> }
  ? Row
  : never;

class StubFindManyDelegate<Row> {
  readonly calls: unknown[] = [];

  constructor(private readonly rows: Row[] = []) {}

  async findMany(args: unknown): Promise<Row[]> {
    this.calls.push(args);
    return this.rows;
  }
}

class StubFindUniqueDelegate<Row> {
  constructor(private readonly row: Row | null = null) {}

  async findUnique(_args: unknown): Promise<Row | null> {
    return this.row;
  }
}

class StubGrantUsageDelegate extends StubFindManyDelegate<RowOf<Database["grantUsage"]>> {
  readonly creates: unknown[] = [];
  readonly updates: unknown[] = [];

  constructor(
    rows: RowOf<Database["grantUsage"]>[] = [],
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
  readonly organization = new StubFindUniqueDelegate<{ createdAt: Date }>();
  readonly roleBinding: StubFindManyDelegate<RowOf<Database["roleBinding"]>>;
  readonly customRole = new StubFindManyDelegate<RowOf<Database["customRole"]>>();
  readonly organizationUser = new StubFindManyDelegate<RowOf<Database["organizationUser"]>>();
  readonly grant: StubFindManyDelegate<RowOf<Database["grant"]>>;
  readonly role = new StubFindManyDelegate<RowOf<Database["role"]>>();
  readonly teamUser = new StubFindManyDelegate<RowOf<Database["teamUser"]>>();
  readonly groupMembership = new StubFindManyDelegate<RowOf<Database["groupMembership"]>>();
  readonly project = new StubFindManyDelegate<RowOf<Database["project"]>>();
  readonly shareLink = new StubFindManyDelegate<RowOf<Database["shareLink"]>>();
  readonly grantUsage: StubGrantUsageDelegate;

  constructor(
    options: {
      bindings?: RowOf<Database["roleBinding"]>[];
      grants?: RowOf<Database["grant"]>[];
      usages?: RowOf<Database["grantUsage"]>[];
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

    await expect(repository.findLegacyBindingRows({ organizationId: "org_1" })).resolves.toEqual([
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
          scopeType: "TRACE",
          scopeId: "trace_1",
          projectId: "project_1",
          principalType: "ANYONE",
          principalId: null,
          roleKey: null,
          legacyRole: null,
          revokedAt: null,
          expiresAt: null,
          maxViews: 10,
        },
        {
          id: "grant_2",
          source: "migration",
          token: "token_2",
          resourceKind: "TRACE",
          scopeType: "TRACE",
          scopeId: "trace_2",
          projectId: "project_1",
          principalType: "ANYONE",
          principalId: null,
          roleKey: null,
          legacyRole: null,
          revokedAt: null,
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
