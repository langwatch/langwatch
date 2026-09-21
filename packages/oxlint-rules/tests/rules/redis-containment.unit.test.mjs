import { afterAll, describe, expect, it } from "vitest";
import { redisContainmentRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const SERVICE = "modules/agent/process/src/services/agent.service.ts";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename = SERVICE) {
  return runRule(redisContainmentRule, { code, cwd: workspace.cwd, filename });
}

function ids(code, filename) {
  return report(code, filename).map((entry) => entry.messageId);
}

describe("given a feature package file", () => {
  describe("when a service value-imports the ioredis driver", () => {
    /** @scenario "A service value-importing the ioredis driver is reported" */
    it("reports redisClient", () => {
      expect(ids('import Redis from "ioredis";')).toEqual(["redisClient"]);
    });
  });

  describe("when a service value-imports the redis client package", () => {
    /** @scenario "A service value-importing the redis client package is reported" */
    it("reports redisClient", () => {
      expect(
        ids('import { RedisConnection } from "@langwatch/redis-client";'),
      ).toEqual(["redisClient"]);
    });
  });

  describe("when a service value-imports a redis client subpath", () => {
    /** @scenario "A service value-importing a redis client subpath is reported" */
    it("reports redisClient", () => {
      expect(
        ids('import { SessionStateStoreFactory } from "@langwatch/redis-client/session-state";'),
      ).toEqual(["redisClient"]);
    });
  });

  describe("when a service imports only the ioredis type", () => {
    /** @scenario "A type-only ioredis import is allowed anywhere" */
    it("reports nothing", () => {
      expect(ids('import type { Redis } from "ioredis";')).toEqual([]);
    });
  });

  describe("when a service imports only the redis client type", () => {
    /** @scenario "A type-only redis client import is allowed anywhere" */
    it("reports nothing", () => {
      expect(
        ids('import type { SessionStateStore } from "@langwatch/redis-client/session-state";'),
      ).toEqual([]);
    });
  });

  describe("when the redis repository folder value-imports the client", () => {
    /** @scenario "The redis repository seam is allowed" */
    it("reports nothing", () => {
      expect(
        ids(
          'import Redis from "ioredis";',
          "modules/agent/process/src/repositories/redis/redis.agent.repository.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when the redis adapter value-imports the client", () => {
    /** @scenario "The redis composition adapter is allowed" */
    it("reports nothing", () => {
      expect(
        ids(
          'import Redis from "ioredis";',
          "modules/agent/process/src/adapters/redis.agent.adapter.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when a Postgres-named adapter value-imports the redis client", () => {
    /** @scenario "An adapter for another store is still governed" */
    it("reports redisClient", () => {
      expect(
        ids(
          'import Redis from "ioredis";',
          "modules/agent/process/src/adapters/postgres.agent.adapter.ts",
        ),
      ).toEqual(["redisClient"]);
    });
  });
});

describe("given a composition root", () => {
  describe("when a file spelled *.composition.ts value-imports the client", () => {
    /** @scenario "The dot-composition spelling of a composition root is allowed" */
    it("reports nothing", () => {
      expect(
        ids(
          'import Redis from "ioredis";',
          "apps/worker/src/app/worker-agent.composition.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when a file spelled *-composition.build.ts value-imports the client", () => {
    /** @scenario "The dash-composition-build spelling of a composition root is allowed" */
    it("reports nothing", () => {
      expect(
        ids(
          'import Redis from "ioredis";',
          "modules/agent/process/src/app/agent-composition.build.ts",
        ),
      ).toEqual([]);
    });
  });
});

describe("given an application file", () => {
  describe("when a platform config file value-imports the client", () => {
    /** @scenario "An application config file is allowed" */
    it("reports nothing", () => {
      expect(
        ids(
          'import { RedisConfigService } from "@langwatch/redis-client";',
          "apps/worker/src/platform/config/worker.config.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when a file outside config or composition value-imports the client", () => {
    /** @scenario "An application file outside the boot seam is still governed" */
    it("reports redisClient", () => {
      expect(
        ids(
          'import Redis from "ioredis";',
          "apps/worker/src/app/worker-agent.task.ts",
        ),
      ).toEqual(["redisClient"]);
    });
  });
});

describe("given the additional seams named for this rule", () => {
  describe("when the redis client package itself value-imports the driver", () => {
    /** @scenario "The redis client package is allowed to import its own driver" */
    it("reports nothing", () => {
      expect(
        ids('import Redis from "ioredis";', "packages/redis-client/src/client.ts"),
      ).toEqual([]);
    });
  });

  describe("when the process-stores package value-imports the client", () => {
    /** @scenario "The process-stores package is allowed" */
    it("reports nothing", () => {
      expect(
        ids('import Redis from "ioredis";', "packages/process-stores/src/redis-members.ts"),
      ).toEqual([]);
    });
  });

  describe("when the test harness package value-imports the client", () => {
    /** @scenario "The test harness package is allowed" */
    it("reports nothing", () => {
      expect(
        ids('import Redis from "ioredis";', "packages/test-harness/src/redis-fixture.ts"),
      ).toEqual([]);
    });
  });

  describe("when the group-queue package value-imports the driver", () => {
    /** @scenario "The group-queue package is allowed" */
    it("reports nothing", () => {
      expect(
        ids('import Redis from "ioredis";', "packages/group-queue/src/queue.ts"),
      ).toEqual([]);
    });
  });
});

describe("given a re-export or dynamic import", () => {
  describe("when a value is re-exported from the client", () => {
    /** @scenario "Re-exporting a client value is reported" */
    it("reports redisClient", () => {
      expect(
        ids('export { RedisConnection } from "@langwatch/redis-client";'),
      ).toEqual(["redisClient"]);
    });
  });

  describe("when only a type is re-exported from the client", () => {
    /** @scenario "Re-exporting a client type is allowed" */
    it("reports nothing", () => {
      expect(
        ids('export type { RedisConnection } from "@langwatch/redis-client";'),
      ).toEqual([]);
    });
  });

  describe("when the driver is reached through a dynamic import", () => {
    /** @scenario "A dynamic import of the driver is reported" */
    it("reports redisClient", () => {
      expect(ids('const mod = await import("ioredis");')).toEqual(["redisClient"]);
    });
  });
});

describe("given a file outside the governed source", () => {
  describe("when it is a test file", () => {
    /** @scenario "Test files keep their redis client import" */
    it("reports nothing", () => {
      expect(
        ids(
          'import Redis from "ioredis";',
          "modules/agent/process/src/__tests__/agent.unit.test.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when the package is not one this rule recognizes", () => {
    /** @scenario "An ungoverned package is left alone" */
    it("reports nothing", () => {
      expect(
        ids('import Redis from "ioredis";', "packages/observability/src/request/requestLogging.ts"),
      ).toEqual([]);
    });
  });
});
