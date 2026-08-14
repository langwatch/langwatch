// A tiny in-memory stand-in for the slice of Prisma the membership lifecycle
// touches. It exists because the interesting behaviour here is transactional —
// "the closing rows and the membership change commit together or not at all"
// cannot be asserted against a mock that records calls, only against a store
// that can roll back. Rows are plain objects; `$transaction` snapshots every
// table and restores it if the callback throws.

type Row = Record<string, unknown>;

type Where = Record<string, unknown> | undefined;

const matchesCondition = (value: unknown, condition: unknown): boolean => {
  if (
    condition !== null &&
    typeof condition === "object" &&
    "not" in (condition as Row)
  ) {
    return value !== (condition as { not: unknown }).not;
  }
  if (
    condition !== null &&
    typeof condition === "object" &&
    "in" in (condition as Row)
  ) {
    return (condition as { in: unknown[] }).in.includes(value);
  }
  return value === condition;
};

const matches = (row: Row, where: Where): boolean => {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") {
      return (condition as Where[]).some((clause) => matches(row, clause));
    }
    return matchesCondition(row[key], condition);
  });
};

class Table {
  constructor(public rows: Row[]) {}

  findMany({
    where,
    distinct,
  }: {
    where?: Where;
    distinct?: string[];
    select?: Row;
  } = {}): Promise<Row[]> {
    let found = this.rows.filter((row) => matches(row, where));
    if (distinct) {
      const seen = new Set<string>();
      found = found.filter((row) => {
        const key = distinct.map((field) => String(row[field])).join("\u0000");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    return Promise.resolve(found.map((row) => ({ ...row })));
  }

  async findFirst(args: { where?: Where } = {}): Promise<Row | null> {
    const [first] = await this.findMany(args);
    return first ?? null;
  }

  findUnique({ where }: { where: Row; select?: Row }): Promise<Row | null> {
    // Compound ids arrive as a single nested key (userId_organizationId).
    const flattened: Row = {};
    for (const [key, value] of Object.entries(where)) {
      if (value !== null && typeof value === "object") {
        Object.assign(flattened, value as Row);
      } else {
        flattened[key] = value;
      }
    }
    return this.findFirst({ where: flattened });
  }

  count({ where }: { where?: Where } = {}): Promise<number> {
    return Promise.resolve(
      this.rows.filter((row) => matches(row, where)).length,
    );
  }

  create({ data }: { data: Row }): Promise<Row> {
    const row = { id: `row-${this.rows.length + 1}`, ...data };
    this.rows.push(row);
    return Promise.resolve({ ...row });
  }

  updateMany({
    where,
    data,
  }: {
    where?: Where;
    data: Row;
  }): Promise<{ count: number }> {
    let count = 0;
    for (const row of this.rows) {
      if (!matches(row, where)) continue;
      Object.assign(row, data);
      count += 1;
    }
    return Promise.resolve({ count });
  }

  async update({ where, data }: { where: Row; data: Row }): Promise<Row> {
    const row = await this.findUnique({ where });
    if (!row) throw new Error("record not found");
    const stored = this.rows.find((candidate) =>
      Object.entries(row).every(([key, value]) => candidate[key] === value),
    )!;
    Object.assign(stored, data);
    return { ...stored };
  }

  deleteMany({ where }: { where?: Where } = {}): Promise<{ count: number }> {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !matches(row, where));
    return Promise.resolve({ count: before - this.rows.length });
  }
}

export type FakePrisma = ReturnType<typeof createFakePrisma>;

export const createFakePrisma = (seed: {
  users?: Row[];
  organizationUsers?: Row[];
  providerIdentityLinks?: Row[];
  ingestionSources?: Row[];
  discoveredAgents?: Row[];
}) => {
  const tables = {
    user: new Table(seed.users ?? []),
    organizationUser: new Table(seed.organizationUsers ?? []),
    providerIdentityLink: new Table(seed.providerIdentityLinks ?? []),
    ingestionSource: new Table(seed.ingestionSources ?? []),
    discoveredAgent: new Table(seed.discoveredAgents ?? []),
    roleBinding: new Table([]),
    session: new Table([]),
  };

  const client = {
    ...tables,
    user: Object.assign(tables.user, {
      /**
       * The lifecycle hook reads a person's memberships as a relation under
       * their user row, because the tenancy guard refuses a bare
       * cross-organization `organizationUser` query. The stand-in has to
       * answer the same shape or the unit tests would exercise a query the
       * real client never runs.
       */
      findUnique: ({ where, select }: { where: Row; select?: Row }) => {
        const row = tables.user.rows.find(
          (candidate) => candidate.id === where.id,
        );
        if (!row) return Promise.resolve(null);
        if (!select?.orgMemberships) return Promise.resolve({ ...row });
        const membershipSelect = select.orgMemberships as {
          where?: Where;
        };
        return Promise.resolve({
          ...row,
          orgMemberships: tables.organizationUser.rows.filter(
            (membership) =>
              membership.userId === row.id &&
              matches(membership, membershipSelect.where),
          ),
        });
      },
    }),
    /**
     * The sweep's one raw query, computed over these tables instead of parsed:
     * link rows naming a person who holds no active membership of that
     * organization. The SQL text itself is only exercised against real
     * Postgres — what this stands in for is the anti-join's MEANING, so the
     * sweep's own logic (close, then close nothing on a second pass) is what
     * the test actually observes.
     */
    $queryRaw(): Promise<Row[]> {
      const pairs = new Map<string, Row>();
      for (const linkRow of tables.providerIdentityLink.rows) {
        if (linkRow.userId === null || linkRow.userId === undefined) continue;
        const stillActive = tables.organizationUser.rows.some(
          (membership) =>
            membership.userId === linkRow.userId &&
            membership.organizationId === linkRow.organizationId &&
            membership.disabledAt === null,
        );
        if (stillActive) continue;
        pairs.set(`${linkRow.organizationId} ${linkRow.userId}`, {
          organizationId: linkRow.organizationId,
          userId: linkRow.userId,
        });
      }
      return Promise.resolve([...pairs.values()]);
    },
    async $transaction(callback: (tx: unknown) => Promise<unknown>) {
      const snapshot = Object.values(tables).map(
        (table) => [table, table.rows.map((row) => ({ ...row }))] as const,
      );
      try {
        return await callback(client);
      } catch (error) {
        for (const [table, rows] of snapshot) table.rows = rows;
        throw error;
      }
    },
  };
  return client;
};
