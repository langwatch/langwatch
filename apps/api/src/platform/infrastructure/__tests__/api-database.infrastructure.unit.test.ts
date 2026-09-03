import { ResourceScope } from "@langwatch/runtime-composition";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the CONSTRUCTION decision is intercepted: `connect` opens a pg pool and
// a Prisma client, which a unit test must not do. Everything else in the
// package stays real — above all the tenancy guard, because the guard being
// real is what these scenarios are about.
const composed = vi.hoisted(() => ({
  guards: [] as unknown[],
  connect: vi.fn(),
}));

vi.mock("@langwatch/prisma-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langwatch/prisma-client")>();
  return {
    ...actual,
    PrismaConnectionService: {
      create: (options: { guard: unknown }) => {
        composed.guards.push(options.guard);
        return { connect: composed.connect };
      },
    },
  };
});

import {
  PrismaConnection,
  type PrismaQueryContext,
  PrismaQueryGuard,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import {
  ApiDatabaseAbsenceReportPort,
  ApiDatabaseInfrastructure,
} from "../api-database.infrastructure";

type ConnectionParts = {
  connection: PrismaConnection;
  client: { $disconnect: ReturnType<typeof vi.fn> };
  pool: { end: ReturnType<typeof vi.fn> };
};

function fakeConnection(): ConnectionParts {
  const client = { $disconnect: vi.fn(async () => {}) };
  const pool = { end: vi.fn(async () => {}) };
  const connection = PrismaConnection.create({ client, pool } as unknown as Parameters<
    typeof PrismaConnection.create
  >[0]);
  return { connection, client, pool };
}

class RecordedAbsence extends ApiDatabaseAbsenceReportPort {
  calls = 0;

  absent(): void {
    this.calls += 1;
  }
}

let parts: ConnectionParts;

beforeEach(() => {
  composed.guards.length = 0;
  parts = fakeConnection();
  composed.connect.mockReset().mockImplementation(() => parts.connection);
});

function compose(
  url: string | undefined,
  resources = new ResourceScope(),
): {
  infrastructure: ApiDatabaseInfrastructure;
  resources: ResourceScope;
} {
  const infrastructure = ApiDatabaseInfrastructure.create({
    resources,
    database: { url },
    nodeEnvironment: "test",
  });
  return { infrastructure, resources };
}

describe("ApiDatabaseInfrastructure", () => {
  describe("given a deployment that configured no database", () => {
    it("composes nothing and says so, rather than refusing the boot", () => {
      const report = new RecordedAbsence();

      const infrastructure = ApiDatabaseInfrastructure.tryCreate({
        resources: new ResourceScope(),
        database: { url: undefined },
        nodeEnvironment: "test",
        report,
      });

      expect(infrastructure).toBeUndefined();
      expect(report.calls).toBe(1);
      expect(composed.connect).not.toHaveBeenCalled();
    });

    it("treats a variable exported blank as unconfigured, not as a connection string", () => {
      const report = new RecordedAbsence();

      const infrastructure = ApiDatabaseInfrastructure.tryCreate({
        resources: new ResourceScope(),
        database: { url: "   \t \n " },
        nodeEnvironment: "test",
        report,
      });

      expect(infrastructure).toBeUndefined();
      expect(report.calls).toBe(1);
      expect(composed.connect).not.toHaveBeenCalled();
    });

    it("refuses an explicit construction instead of handing back an unusable client", () => {
      expect(() => compose(undefined)).toThrow(/DATABASE_URL/);
      expect(composed.connect).not.toHaveBeenCalled();
    });
  });

  describe("given a configured database", () => {
    it("opens exactly one connection and answers with that same one", () => {
      const { infrastructure } = compose("postgresql://localhost/langwatch");

      expect(composed.connect).toHaveBeenCalledTimes(1);
      expect(infrastructure.connection).toBe(parts.connection);
      expect(infrastructure.connection).toBe(infrastructure.connection);
    });

    it("passes the trimmed URL and the non-development log policy through", () => {
      compose("  postgresql://localhost/langwatch  ");

      expect(composed.connect).toHaveBeenCalledWith({
        databaseUrl: "postgresql://localhost/langwatch",
        log: ["error"],
      });
    });

    it("keeps the development log policy the legacy app uses", () => {
      ApiDatabaseInfrastructure.create({
        resources: new ResourceScope(),
        database: { url: "postgresql://localhost/langwatch" },
        nodeEnvironment: "development",
      });

      expect(composed.connect).toHaveBeenCalledWith({
        databaseUrl: "postgresql://localhost/langwatch",
        log: ["error", "warn"],
      });
    });
  });

  describe("given the client this infrastructure hands out", () => {
    it("is built with the packaged tenancy guard, which is the only guard on offer", () => {
      compose("postgresql://localhost/langwatch");

      expect(composed.guards).toHaveLength(1);
      expect(composed.guards[0]).toBeInstanceOf(PrismaTenancyGuardService);
    });

    it("refuses a project-scoped read that carries no projectId", async () => {
      compose("postgresql://localhost/langwatch");
      const guard = composed.guards[0] as PrismaQueryGuard;

      await expect(
        guard.execute(
          {
            model: "ShareLink",
            action: "findFirst",
            args: { where: { resourceType: "TRACE", resourceId: "trace_a" } },
          },
          async (args) => args,
        ),
      ).rejects.toThrow(/requires a 'projectId'/);
    });

    it("lets the same read through once it names its project", async () => {
      compose("postgresql://localhost/langwatch");
      const guard = composed.guards[0] as PrismaQueryGuard;
      const context: PrismaQueryContext = {
        model: "ShareLink",
        action: "findFirst",
        args: { where: { projectId: "project_1", resourceId: "trace_a" } },
      };

      await expect(guard.execute(context, async () => "ok")).resolves.toBe("ok");
    });

    it("is the guard on BOTH entry points, so no path composes an unguarded client", () => {
      compose("postgresql://localhost/langwatch");
      ApiDatabaseInfrastructure.tryCreate({
        resources: new ResourceScope(),
        database: { url: "postgresql://localhost/langwatch" },
        nodeEnvironment: "test",
      });

      expect(composed.guards).toHaveLength(2);
      expect(composed.guards.every((guard) => guard instanceof PrismaTenancyGuardService)).toBe(
        true,
      );
    });
  });

  describe("when the process closes", () => {
    it("disconnects the client and then releases the pool", async () => {
      const { infrastructure } = compose("postgresql://localhost/langwatch");

      await infrastructure.close();

      expect(parts.client.$disconnect).toHaveBeenCalledTimes(1);
      expect(parts.pool.end).toHaveBeenCalledTimes(1);
    });

    it("disconnects once however many times it is closed", async () => {
      const { infrastructure } = compose("postgresql://localhost/langwatch");

      await Promise.all([infrastructure.close(), infrastructure.close()]);
      await infrastructure.close();

      expect(parts.client.$disconnect).toHaveBeenCalledTimes(1);
      expect(parts.pool.end).toHaveBeenCalledTimes(1);
    });

    it("is released by the process resource scope, so no caller has to remember", async () => {
      const resources = new ResourceScope();
      compose("postgresql://localhost/langwatch", resources);

      await resources.close();

      expect(parts.client.$disconnect).toHaveBeenCalledTimes(1);
      expect(parts.pool.end).toHaveBeenCalledTimes(1);
    });
  });
});
