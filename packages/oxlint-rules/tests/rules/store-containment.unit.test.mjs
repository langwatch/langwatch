import { afterAll, describe, expect, it } from "vitest";

import { storeContainmentRule } from "../../src/rules/store-containment.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { contract: {}, process: {} } } },
});

afterAll(() => workspace.cleanup());

const PROCESS = "modules/agent/process/src";
const SERVICE = `${PROCESS}/services/agent.service.ts`;

function report(filename, code) {
  return runRule(storeContainmentRule, { code, cwd: workspace.cwd, filename }).map(
    ({ data, line, messageId }) => ({ line, messageId, store: data.store }),
  );
}

describe("given a service", () => {
  describe("when it value-imports a ClickHouse or Redis client", () => {
    /** @scenario "A store client value-imported outside its repository folder is reported" */
    it("reports storeClientValue on the import's line", () => {
      const code = [
        'import { z } from "zod";',
        'import { createClient } from "@clickhouse/client";',
        'import Redis from "ioredis";',
        'import { RedisConnectionService } from "@langwatch/redis-client";',
      ].join("\n");

      expect(report(SERVICE, code)).toEqual([
        { line: 2, messageId: "storeClientValue", store: "ClickHouse" },
        { line: 3, messageId: "storeClientValue", store: "Redis" },
        { line: 4, messageId: "storeClientValue", store: "Redis" },
      ]);
    });
  });

  describe("when it only reads a ClickHouse or Redis type", () => {
    /** @scenario "A ClickHouse or Redis type travels anywhere" */
    it("reports nothing for a type-only import in either spelling", () => {
      const code = [
        'import type { ClickHouseClient } from "@langwatch/clickhouse-client";',
        'import { type Redis } from "@langwatch/redis-client";',
      ].join("\n");

      expect(report(SERVICE, code)).toEqual([]);
    });
  });

  describe("when it names Prisma, even as a type", () => {
    /** @scenario "Prisma named outside repositories/prisma is reported, even as a type" */
    it("reports storeNamed", () => {
      const code = [
        'import type { PrismaClient } from "@langwatch/prisma-client/generated";',
        'import { PrismaRepository } from "@langwatch/prisma-client";',
      ].join("\n");

      expect(report(SERVICE, code)).toEqual([
        { line: 1, messageId: "storeNamed", store: "Prisma" },
        { line: 2, messageId: "storeNamed", store: "Prisma" },
      ]);
    });
  });

  describe("when it loads a client dynamically or re-exports one", () => {
    /** @scenario "A store client value-imported outside its repository folder is reported" */
    it("reports each form", () => {
      const code = [
        'export { createClient } from "@clickhouse/client";',
        'export const open = () => import("ioredis");',
      ].join("\n");

      expect(report(SERVICE, code).map(({ line }) => line)).toEqual([1, 2]);
    });
  });
});

describe("given a repository under its store's folder", () => {
  /** @scenario "A repository under its store's folder names that store" */
  it("reports nothing for its own store, value or type", () => {
    expect(
      report(
        `${PROCESS}/repositories/prisma/prisma.agent.repository.ts`,
        'import { PrismaRepository, withSerializationRetry } from "@langwatch/prisma-client";\n' +
          'import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";',
      ),
    ).toEqual([]);
    expect(
      report(
        `${PROCESS}/repositories/clickhouse/clickhouse.agent.repository.ts`,
        'import { createClient } from "@clickhouse/client";',
      ),
    ).toEqual([]);
  });

  /** @scenario "A repository under another store's folder is reported" */
  it("reports a client of a different store", () => {
    expect(
      report(
        `${PROCESS}/repositories/prisma/prisma.agent.repositories.ts`,
        'import { RedisConnectionService } from "@langwatch/redis-client";',
      ),
    ).toEqual([{ line: 1, messageId: "storeClientValue", store: "Redis" }]);
  });
});

describe("given a Redis channel", () => {
  /** @scenario "A Redis channel speaks to its own client" */
  it("reports nothing for the Redis client and still reports Prisma", () => {
    const channel = `${PROCESS}/channels/redis/redis.agent-broadcast.channel.ts`;

    expect(report(channel, 'import Redis from "ioredis";')).toEqual([]);
    expect(report(channel, 'import { Prisma } from "@langwatch/prisma-client/generated";')).toEqual(
      [{ line: 1, messageId: "storeNamed", store: "Prisma" }],
    );
  });
});

describe("given the repository registry", () => {
  /** @scenario "The repository registry takes the Prisma registry helpers" */
  it("allows the registry helpers and reports anything else", () => {
    const registry = `${PROCESS}/repositories/agent-repositories.registry.ts`;

    expect(
      report(registry, 'import { prismaRepositories } from "@langwatch/prisma-client";'),
    ).toEqual([]);
    expect(
      report(registry, 'import { scopedPrismaClient } from "@langwatch/prisma-client/ownership";'),
    ).toEqual([{ line: 1, messageId: "storeNamed", store: "Prisma" }]);
  });
});

describe("given an application source", () => {
  /** @scenario "An application naming a store client is reported" */
  it("reports storeInApplication for a value import and passes a ClickHouse type", () => {
    expect(report("apps/api/src/main.ts", 'import Redis from "ioredis";')).toEqual([
      { line: 1, messageId: "storeInApplication", store: "Redis" },
    ]);
    expect(
      report("apps/api/src/main.ts", 'import type { ClickHouseClient } from "@clickhouse/client";'),
    ).toEqual([]);
  });
});

describe("given a test file", () => {
  /** @scenario "A test standing a store up is not this rule's business" */
  it("reports nothing", () => {
    expect(
      report(
        `${PROCESS}/services/__tests__/agent.service.unit.test.ts`,
        'import Redis from "ioredis";',
      ),
    ).toEqual([]);
  });
});
