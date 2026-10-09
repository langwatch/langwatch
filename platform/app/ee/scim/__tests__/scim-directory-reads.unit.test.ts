// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import { ScimService } from "../scim.service";
import { isScimError, type ScimUser } from "../scim.types";
import { ScimGroupService } from "../scim-group.service";

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ redis: null }),
  tryGetApp: () => ({ redis: null }),
}));
vi.mock("~/server/app-layer/authz/ledger", () => ({
  grantsLedgerWriter: () => ({
    attachBindings: vi.fn(),
    revokeBindings: vi.fn(),
    revokeBindingsWhere: vi.fn(),
    offboardMember: vi.fn(),
    defineRole: vi.fn(),
    deleteRole: vi.fn(),
  }),
}));

const ORG = "org-acme";
const OKTA = "conn-okta-primary";
const ENTRA = "conn-entra-contractors";

interface Row {
  userId: string;
  email: string;
  name: string;
}

/**
 * A store that behaves the way Postgres is ALLOWED to behave.
 *
 * The point of the fake is the `orderBy` branch. A real database offers no
 * order unless it is asked for one, and it is free to answer the same query
 * differently on two calls — which is precisely what made paging a large
 * directory unsafe and precisely what a mock returning a stable array would
 * hide. So an unordered read here is answered in a rotating order, and a test
 * that walks the pages of an unordered listing fails the way production did.
 */
function makeStore(rows: Row[]) {
  let unorderedReads = 0;

  const matches = (row: Row, where: Record<string, unknown>): boolean => {
    const scope = where.OR as {
      orgMemberships?: { some: { organizationId: string } };
    }[];
    if (scope[0]?.orgMemberships?.some.organizationId !== ORG) return false;
    const filter = where.AND as
      | { OR: { email?: { equals: string } }[] }[]
      | undefined;
    const email = filter?.[0]?.OR[1]?.email?.equals;
    if (email !== undefined && row.email.toLowerCase() !== email.toLowerCase())
      return false;
    const id = where.id as { in?: string[] } | undefined;
    return id?.in === undefined || id.in.includes(row.userId);
  };

  const findMany = vi.fn(
    ({
      where,
      skip = 0,
      take,
      orderBy,
    }: {
      where: Record<string, unknown>;
      skip?: number;
      take?: number;
      orderBy?: { id?: "asc" | "desc" };
    }) => {
      const matched = rows.filter((row) => matches(row, where));
      let ordered: Row[];
      if (orderBy?.id === "asc") {
        ordered = [...matched].sort((a, b) => a.userId.localeCompare(b.userId));
      } else {
        // No order asked for, so no order promised. Rotating by one on every
        // read is a legal answer and a ruinous one to page over.
        unorderedReads += 1;
        const pivot = unorderedReads % Math.max(matched.length, 1);
        ordered = [...matched.slice(pivot), ...matched.slice(0, pivot)];
      }
      const page = ordered.slice(
        skip,
        take === undefined ? undefined : skip + take,
      );
      return Promise.resolve(
        page.map((row) => ({
          scimUserResources: [],
          id: row.userId,
          name: row.name,
          email: row.email,
          emailVerified: true,
          createdAt: new Date("2024-01-01T00:00:00Z"),
          updatedAt: new Date("2024-01-02T00:00:00Z"),
          deactivatedAt: null,
        })),
      );
    },
  );

  const count = vi.fn(({ where }: { where: Record<string, unknown> }) =>
    Promise.resolve(rows.filter((row) => matches(row, where)).length),
  );

  const externalIds: {
    connectionId: string;
    externalId: string;
    userId: string;
  }[] = [];
  const findUnique = vi.fn(
    ({
      where,
    }: {
      where: {
        connectionId_externalId: { connectionId: string; externalId: string };
      };
    }) => {
      const { connectionId, externalId } = where.connectionId_externalId;
      const hit = externalIds.find(
        (row) =>
          row.connectionId === connectionId && row.externalId === externalId,
      );
      return Promise.resolve(hit ? { userId: hit.userId } : null);
    },
  );

  const prisma = {
    user: { findMany, count },
    scimExternalId: { findUnique },
  } as unknown as PrismaClient;

  return {
    prisma,
    findMany,
    rows,
    mapExternalId: (args: {
      connectionId: string;
      externalId: string;
      userId: string;
    }) => externalIds.push(args),
  };
}

function directoryOf(size: number): Row[] {
  return Array.from({ length: size }, (_, i) => {
    // Zero-padded so lexical order and numeric order agree, which is what
    // makes "exactly once" checkable against a known sequence.
    const n = String(i + 1).padStart(5, "0");
    return {
      userId: `user-${n}`,
      email: `person${n}@acme.com`,
      name: `P ${n}`,
    };
  });
}

/** Walk every page the way a provider does, advancing by what it received. */
async function walkEveryPage({
  service,
  pageSize,
}: {
  service: ScimService;
  pageSize: number;
}): Promise<{ seen: string[]; pages: number }> {
  const seen: string[] = [];
  let startIndex = 1;
  let pages = 0;
  for (let guard = 0; guard < 1000; guard++) {
    const page = await service.listUsers({
      organizationId: ORG,
      startIndex,
      count: pageSize,
    });
    if (isScimError(page))
      throw new Error(`unexpected refusal: ${page.detail}`);
    pages += 1;
    for (const resource of page.Resources) seen.push(resource.id);
    if (page.Resources.length === 0) break;
    startIndex += page.Resources.length;
    if (startIndex > page.totalResults) break;
  }
  return { seen, pages };
}

describe("reading the directory back", () => {
  describe("given a directory far larger than one page", () => {
    let store: ReturnType<typeof makeStore>;
    let service: ScimService;

    beforeEach(() => {
      store = makeStore(directoryOf(5000));
      service = ScimService.create({ prisma: store.prisma });
    });

    /** @scenario "Paging through a large directory lists everybody exactly once" */
    it("tiles the directory with no repeats and no gaps", async () => {
      const { seen } = await walkEveryPage({ service, pageSize: 100 });

      expect(seen).toHaveLength(5000);
      expect(new Set(seen).size).toBe(5000);
      expect(seen).toEqual(store.rows.map((row) => row.userId));
    });

    /** @scenario "The order a page is cut from is fixed rather than whatever the store offers" */
    it("asks the store for a settled order rather than taking what it offers", async () => {
      const first = await service.listUsers({ organizationId: ORG, count: 10 });
      const again = await service.listUsers({ organizationId: ORG, count: 10 });
      if (isScimError(first) || isScimError(again)) throw new Error("refused");

      // The pin: without an order the store is free to rotate, and the two
      // reads above would disagree.
      expect(store.findMany.mock.calls[0]?.[0].orderBy).toEqual({
        id: "asc",
      });
      expect(ids(again.Resources)).toEqual(ids(first.Resources));
    });

    /** @scenario "The total is the whole directory, never the page" */
    it("reports the whole directory as the total on every page", async () => {
      const page = await service.listUsers({
        organizationId: ORG,
        startIndex: 2001,
        count: 100,
      });
      if (isScimError(page)) throw new Error("refused");

      expect(page.totalResults).toBe(5000);
      expect(page.Resources).toHaveLength(100);
    });

    /** @scenario "A start past the end of the directory is an empty page, not a failure" */
    it("answers a start past the end with an empty page that still counts", async () => {
      const page = await service.listUsers({
        organizationId: ORG,
        startIndex: 9000,
        count: 100,
      });
      if (isScimError(page)) throw new Error("refused");

      expect(page.Resources).toEqual([]);
      expect(page.totalResults).toBe(5000);
      expect(page.itemsPerPage).toBe(0);
    });
  });

  describe("given a directory whose size is not a multiple of the page", () => {
    /** @scenario "The last page reports how many people it actually carries" */
    it("reports the short last page at its real size", async () => {
      const store = makeStore(directoryOf(205));
      const service = ScimService.create({ prisma: store.prisma });

      const last = await service.listUsers({
        organizationId: ORG,
        startIndex: 201,
        count: 100,
      });
      if (isScimError(last)) throw new Error("refused");

      expect(last.Resources).toHaveLength(5);
      expect(last.itemsPerPage).toBe(5);
    });

    /** @scenario "A full page reports the whole page" */
    it("reports a full page as full", async () => {
      const store = makeStore(directoryOf(205));
      const service = ScimService.create({ prisma: store.prisma });

      const first = await service.listUsers({
        organizationId: ORG,
        count: 100,
      });
      if (isScimError(first)) throw new Error("refused");

      expect(first.itemsPerPage).toBe(100);
    });

    /** @scenario "A provider that advances by what it was told lands on the end exactly" */
    it("lets a provider advancing by the reported count reach the last person", async () => {
      const store = makeStore(directoryOf(205));
      const service = ScimService.create({ prisma: store.prisma });

      // Advancing by `itemsPerPage` is a legal reading of the protocol. When
      // that number was the REQUEST rather than the page, this walk stepped
      // from 201 to 301 and never saw the final five.
      const seen: string[] = [];
      let startIndex = 1;
      for (let guard = 0; guard < 20; guard++) {
        const page = await service.listUsers({
          organizationId: ORG,
          startIndex,
          count: 100,
        });
        if (isScimError(page)) throw new Error("refused");
        for (const resource of page.Resources) seen.push(resource.id);
        if (page.Resources.length === 0) break;
        startIndex += page.itemsPerPage;
      }

      expect(seen).toHaveLength(205);
      expect(seen.at(-1)).toBe("user-00205");
    });
  });

  describe("when the directory grows between two pages", () => {
    /** @scenario "A directory that grows mid-walk repeats somebody rather than losing them" */
    it("repeats at worst, and still shows everybody who was already there", async () => {
      const rows = directoryOf(150);
      const store = makeStore(rows);
      const service = ScimService.create({ prisma: store.prisma });
      const presentAtStart = rows.map((row) => row.userId);

      const first = await service.listUsers({
        organizationId: ORG,
        count: 100,
      });
      if (isScimError(first)) throw new Error("refused");

      // A joiner who sorts into the middle of the page already read.
      rows.push({
        userId: "user-00050a",
        email: "joiner@acme.com",
        name: "J J",
      });
      rows.sort((a, b) => a.userId.localeCompare(b.userId));

      const second = await service.listUsers({
        organizationId: ORG,
        startIndex: 101,
        count: 100,
      });
      if (isScimError(second)) throw new Error("refused");

      const seen = [...ids(first.Resources), ...ids(second.Resources)];
      for (const userId of presentAtStart) {
        expect(seen).toContain(userId);
      }
    });
  });

  describe("when a filter names something the directory cannot match on", () => {
    let store: ReturnType<typeof makeStore>;
    let service: ScimService;

    beforeEach(() => {
      store = makeStore(directoryOf(5000));
      service = ScimService.create({ prisma: store.prisma });
    });

    /** @scenario "A filter on something we do not support is refused" */
    it("refuses it as an invalid filter", async () => {
      const result = await service.listUsers({
        organizationId: ORG,
        filter: 'costCenter eq "cc-12"',
      });

      expect(isScimError(result)).toBe(true);
      if (!isScimError(result)) throw new Error("expected a refusal");
      expect(result.status).toBe("400");
      expect(result.scimType).toBe("invalidFilter");
    });

    /** @scenario "An unsupported filter never widens into the whole organization" */
    it("never answers with the whole organization instead", async () => {
      const result = await service.listUsers({
        organizationId: ORG,
        filter: 'title eq "Head of Engineering"',
      });

      // The defect this replaces: an unparsed filter fell through to "no
      // filter", and the provider read Resources[0] as the person it asked
      // about — then wrote to them.
      expect(isScimError(result)).toBe(true);
      expect(store.findMany).not.toHaveBeenCalled();
    });

    /** @scenario "A refused filter says which filter was refused and nothing else" */
    it("names the attribute it could not honour and nobody in the organization", async () => {
      const result = await service.listUsers({
        organizationId: ORG,
        filter: 'department eq "Platform"',
      });
      if (!isScimError(result)) throw new Error("expected a refusal");

      expect(result.detail).toContain("department");
      // The value carries a person's data often enough that echoing it back
      // is not worth the help it gives.
      expect(result.detail).not.toContain("Platform");
      expect(result.detail).not.toContain("@acme.com");
    });

    /** @scenario "An unsupported filter never widens into the whole organization" */
    it("refuses an expression it cannot parse at all", async () => {
      const result = await service.listUsers({
        organizationId: ORG,
        filter: 'userName sw "a" and active eq true',
      });

      expect(isScimError(result)).toBe(true);
      expect(store.findMany).not.toHaveBeenCalled();
    });
  });

  describe("when a filter names something the directory can match on", () => {
    let store: ReturnType<typeof makeStore>;
    let service: ScimService;

    beforeEach(() => {
      store = makeStore(directoryOf(500));
      service = ScimService.create({ prisma: store.prisma });
    });

    /** @scenario "Looking somebody up by their sign-in address still works" */
    it("finds one person by address, whatever case it was written in", async () => {
      const result = await service.listUsers({
        organizationId: ORG,
        filter: 'userName eq "PERSON00042@ACME.COM"',
      });
      if (isScimError(result)) throw new Error("refused");

      expect(ids(result.Resources)).toEqual(["user-00042"]);
      expect(result.totalResults).toBe(1);
    });

    /** @scenario "A filter matching nobody is an empty page rather than a refusal" */
    it("answers an address nobody holds with an empty page", async () => {
      const result = await service.listUsers({
        organizationId: ORG,
        filter: 'userName eq "nobody@acme.com"',
      });
      if (isScimError(result)) throw new Error("refused");

      expect(result.Resources).toEqual([]);
      expect(result.totalResults).toBe(0);
    });

    /** @scenario "Looking somebody up by the directory's own identifier works" */
    it("finds one person by the identifier their directory means them by", async () => {
      store.mapExternalId({
        connectionId: OKTA,
        externalId: "okta-ext-sam",
        userId: "user-00007",
      });

      const result = await service.listUsers({
        organizationId: ORG,
        connectionId: OKTA,
        filter: 'externalId eq "okta-ext-sam"',
      });
      if (isScimError(result)) throw new Error("refused");

      expect(ids(result.Resources)).toEqual(["user-00007"]);
    });

    /** @scenario "One connection cannot find another connection's person by identifier" */
    it("keeps one connection's identifiers out of another's reach", async () => {
      store.mapExternalId({
        connectionId: OKTA,
        externalId: "shared-ext-id",
        userId: "user-00007",
      });
      store.mapExternalId({
        connectionId: ENTRA,
        externalId: "shared-ext-id",
        userId: "user-00300",
      });

      const throughOkta = await service.listUsers({
        organizationId: ORG,
        connectionId: OKTA,
        filter: 'externalId eq "shared-ext-id"',
      });
      const throughEntra = await service.listUsers({
        organizationId: ORG,
        connectionId: ENTRA,
        filter: 'externalId eq "shared-ext-id"',
      });
      if (isScimError(throughOkta) || isScimError(throughEntra)) {
        throw new Error("refused");
      }

      expect(ids(throughOkta.Resources)).toEqual(["user-00007"]);
      expect(ids(throughEntra.Resources)).toEqual(["user-00300"]);
    });

    /** @scenario "Looking somebody up by the directory's own identifier works" */
    it("answers an identifier this connection has never seen with nobody", async () => {
      const result = await service.listUsers({
        organizationId: ORG,
        connectionId: OKTA,
        filter: 'externalId eq "never-pushed"',
      });
      if (isScimError(result)) throw new Error("refused");

      // The dangerous wrong answer is the whole directory, because the
      // provider takes the first row as a match and updates a stranger.
      expect(result.Resources).toEqual([]);
      expect(result.totalResults).toBe(0);
    });
  });
});

describe("reading the directory's groups back", () => {
  function groupStore(size: number) {
    const rows = Array.from({ length: size }, (_, i) => ({
      id: `group-${String(i + 1).padStart(4, "0")}`,
      organizationId: ORG,
      name: `Department ${i + 1}`,
      externalId: `ext-group-${i + 1}`,
      scimSource: "scim",
      scimConnectionId: OKTA,
      // Every group made in the same instant, which is what leaves
      // `createdAt` alone unable to order them.
      createdAt: new Date("2024-01-01T00:00:00Z"),
      updatedAt: new Date("2024-01-01T00:00:00Z"),
    }));

    let untiebrokenReads = 0;
    const findMany = vi.fn(
      ({
        where,
        skip = 0,
        take,
        orderBy,
      }: {
        where: Record<string, unknown>;
        skip?: number;
        take?: number;
        orderBy?: unknown;
      }) => {
        const nameFilter = where.name as { equals?: string } | undefined;
        const externalFilter = where.externalId as string | undefined;
        let matched = rows.filter((row) => row.organizationId === ORG);
        if (nameFilter?.equals !== undefined) {
          matched = matched.filter(
            (row) =>
              row.name.toLowerCase() === nameFilter.equals?.toLowerCase(),
          );
        }
        if (externalFilter !== undefined) {
          matched = matched.filter((row) => row.externalId === externalFilter);
        }
        // Every group shares one `createdAt`, so ordering by it alone leaves
        // the store free to answer differently each time — which it does
        // here, the way a real one may. Only the id tiebreak settles it.
        let tiebroken: typeof matched;
        if (Array.isArray(orderBy) && orderBy.length > 1) {
          tiebroken = [...matched].sort((a, b) => a.id.localeCompare(b.id));
        } else {
          untiebrokenReads += 1;
          const pivot = untiebrokenReads % Math.max(matched.length, 1);
          tiebroken = [...matched.slice(pivot), ...matched.slice(0, pivot)];
        }
        return Promise.resolve(
          tiebroken
            .slice(skip, take === undefined ? undefined : skip + take)
            .map((row) => ({ ...row, members: [] })),
        );
      },
    );
    const count = vi.fn(() => Promise.resolve(rows.length));
    const prisma = {
      group: { findMany, count },
    } as unknown as PrismaClient;
    return { prisma, rows };
  }

  /** @scenario "Groups are paged from a settled order too" */
  it("tiles the groups with no repeats even when they share a creation instant", async () => {
    const store = groupStore(250);
    const service = ScimGroupService.create({ prisma: store.prisma });

    const seen: string[] = [];
    let startIndex = 1;
    for (let guard = 0; guard < 20; guard++) {
      const page = await service.listGroups({
        organizationId: ORG,
        connectionId: OKTA,
        startIndex,
        count: 100,
      });
      if (isScimError(page)) throw new Error("refused");
      for (const resource of page.Resources) seen.push(resource.id);
      if (page.Resources.length === 0) break;
      startIndex += page.Resources.length;
      if (startIndex > page.totalResults) break;
    }

    expect(seen).toHaveLength(250);
    expect(new Set(seen).size).toBe(250);
  });

  /** @scenario "A group filter follows the same rule as a person filter" */
  it("refuses a filter it cannot honour but still answers one it can", async () => {
    const store = groupStore(10);
    const service = ScimGroupService.create({ prisma: store.prisma });

    const refused = await service.listGroups({
      organizationId: ORG,
      connectionId: OKTA,
      filter: 'members.value eq "user-1"',
    });
    expect(isScimError(refused)).toBe(true);

    const honoured = await service.listGroups({
      organizationId: ORG,
      connectionId: OKTA,
      filter: 'displayName eq "Department 3"',
    });
    if (isScimError(honoured)) throw new Error("refused");
    expect(honoured.Resources).toHaveLength(1);
    expect(honoured.Resources[0]?.displayName).toBe("Department 3");
  });
});

function ids(resources: ScimUser[]): string[] {
  return resources.map((resource) => resource.id);
}
