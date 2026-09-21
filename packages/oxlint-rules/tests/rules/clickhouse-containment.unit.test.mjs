import { afterAll, describe, expect, it } from "vitest";
import { clickhouseContainmentRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const SERVICE = "modules/agent/process/src/services/agent.service.ts";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename = SERVICE) {
  return runRule(clickhouseContainmentRule, { code, cwd: workspace.cwd, filename });
}

function ids(code, filename) {
  return report(code, filename).map((entry) => entry.messageId);
}

describe("given a feature package file", () => {
  describe("when a service value-imports the client", () => {
    /** @scenario "A service value-importing the ClickHouse client is reported" */
    it("reports clickhouseClient", () => {
      expect(ids('import { PLATFORM_TENANT } from "@langwatch/clickhouse-client";')).toEqual([
        "clickhouseClient",
      ]);
    });
  });

  describe("when a service value-imports the ClickHouse driver directly", () => {
    /** @scenario "A service value-importing the ClickHouse driver is reported" */
    it("reports clickhouseClient naming the driver", () => {
      expect(report('import { createClient } from "@clickhouse/client";')).toEqual([
        expect.objectContaining({
          messageId: "clickhouseClient",
          data: { name: "@clickhouse/client" },
        }),
      ]);
    });
  });

  describe("when a service imports only the type", () => {
    /** @scenario "A type-only ClickHouse import is allowed anywhere" */
    it("reports nothing", () => {
      expect(
        ids('import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";'),
      ).toEqual([]);
    });
  });

  describe("when the ClickHouse repository folder value-imports the client", () => {
    /** @scenario "The ClickHouse repository seam is allowed" */
    it("reports nothing", () => {
      expect(
        ids(
          'import { createClient } from "@clickhouse/client";',
          "modules/agent/process/src/repositories/clickhouse/clickhouse.agent.repository.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when the ClickHouse adapter value-imports the client", () => {
    /** @scenario "The ClickHouse composition adapter is allowed" */
    it("reports nothing", () => {
      expect(
        ids(
          'import { ClickHouseQueryClient } from "@langwatch/clickhouse-client";',
          "modules/agent/process/src/adapters/clickhouse.agent.adapter.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when a Postgres-named adapter value-imports the client", () => {
    /** @scenario "An adapter for another store is still governed" */
    it("reports clickhouseClient", () => {
      expect(
        ids(
          'import { PLATFORM_TENANT } from "@langwatch/clickhouse-client";',
          "modules/agent/process/src/adapters/postgres.agent.adapter.ts",
        ),
      ).toEqual(["clickhouseClient"]);
    });
  });

  describe("when a module's composition build value-imports the client", () => {
    /** @scenario "A module composition build is allowed" */
    it("reports nothing", () => {
      expect(
        ids(
          'import { TupleParam } from "@clickhouse/client";',
          "modules/agent/process/src/app/agent-composition.build.ts",
        ),
      ).toEqual([]);
    });
  });
});

describe("given an application file", () => {
  describe("when a composition file value-imports the client", () => {
    /** @scenario "An application composition root is allowed" */
    it("reports nothing", () => {
      expect(
        ids(
          'import { ClickHouseQueryClient } from "@langwatch/clickhouse-client";',
          "apps/worker/src/app/worker-agent.composition.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when a file under platform/infrastructure value-imports the client", () => {
    /** @scenario "The platform infrastructure boot seam is allowed" */
    it("reports nothing", () => {
      expect(
        ids(
          'import { createClient } from "@langwatch/clickhouse-client";',
          "apps/api/src/platform/infrastructure/api-clickhouse.members.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when a config file value-imports the client", () => {
    /** @scenario "An application config file is allowed" */
    it("reports nothing", () => {
      expect(
        ids(
          'import { parseRoutingTable } from "@langwatch/clickhouse-client";',
          "apps/api/src/platform/config/api.config.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when a file that is neither a seam nor config value-imports the client", () => {
    /** @scenario "An application file outside every seam is reported" */
    it("reports clickhouseClient", () => {
      expect(
        ids(
          'import { PLATFORM_TENANT } from "@langwatch/clickhouse-client";',
          "apps/worker/src/features/telemetry/telemetry-rollup.service.ts",
        ),
      ).toEqual(["clickhouseClient"]);
    });
  });
});

describe("given a members file named by convention", () => {
  describe("when a composition package's member file value-imports the client", () => {
    /** @scenario "A boot members file is allowed wherever it is built" */
    it("reports nothing", () => {
      expect(
        ids(
          'import { createClient } from "@langwatch/clickhouse-client";',
          "enterprise/packages/composition/worker/src/members/worker-clickhouse.members.ts",
        ),
      ).toEqual([]);
    });
  });
});

describe("given a package whose whole domain is ClickHouse", () => {
  describe("when the shared process-stores package value-imports the client", () => {
    /** @scenario "A package whose domain is the store is outside the rule" */
    it("reports nothing", () => {
      expect(
        ids(
          'import { PLATFORM_TENANT } from "@langwatch/clickhouse-client";',
          "packages/process-stores/src/tenant-directory.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when the client package itself value-imports the driver", () => {
    /** @scenario "The ClickHouse client package is outside the rule" */
    it("reports nothing", () => {
      expect(
        ids(
          'import { createClient } from "@clickhouse/client";',
          "packages/clickhouse-client/src/client.ts",
        ),
      ).toEqual([]);
    });
  });
});

describe("given a re-export or dynamic import", () => {
  describe("when a value is re-exported from the client", () => {
    /** @scenario "Re-exporting a client value is reported" */
    it("reports clickhouseClient", () => {
      expect(ids('export { PLATFORM_TENANT } from "@langwatch/clickhouse-client";')).toEqual([
        "clickhouseClient",
      ]);
    });
  });

  describe("when only a type is re-exported from the client", () => {
    /** @scenario "Re-exporting a client type is allowed" */
    it("reports nothing", () => {
      expect(ids('export type { TenantDirectory } from "@langwatch/clickhouse-client";')).toEqual(
        [],
      );
    });
  });

  describe("when the client is reached through a dynamic import", () => {
    /** @scenario "A dynamic import of the client is reported" */
    it("reports clickhouseClient", () => {
      expect(ids('const mod = await import("@langwatch/clickhouse-client");')).toEqual([
        "clickhouseClient",
      ]);
    });
  });
});

describe("given a file outside the governed source", () => {
  describe("when it is a test file", () => {
    /** @scenario "Test files keep their ClickHouse client import" */
    it("reports nothing", () => {
      expect(
        ids(
          'import { PLATFORM_TENANT } from "@langwatch/clickhouse-client";',
          "modules/agent/process/src/__tests__/agent.unit.test.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when the package is not one this rule recognizes", () => {
    /** @scenario "An ungoverned package is left alone" */
    it("reports nothing", () => {
      expect(
        ids(
          'import { PLATFORM_TENANT } from "@langwatch/clickhouse-client";',
          "packages/observability/src/request/requestLogging.ts",
        ),
      ).toEqual([]);
    });
  });
});
