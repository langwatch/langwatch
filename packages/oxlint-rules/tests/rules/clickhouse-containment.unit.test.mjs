import { afterAll, describe, expect, it } from "vitest";
import { clickhouseContainmentRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const SERVICE = "modules/agent/server/src/services/agent.service.ts";
const BASELINED = "modules/agent/server/src/services/legacy.service.ts";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
  files: {
    "packages/architecture-enforcer/src/oxlint-baseline.json": JSON.stringify({
      version: 0,
      entries: [{ key: `clickhouse-containment|${BASELINED}`, measured: "2026-09-13" }],
    }),
  },
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
      expect(
        ids('import { PLATFORM_TENANT } from "@langwatch/clickhouse-client";'),
      ).toEqual(["clickhouseClient"]);
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
          'import { ClickHouseQueryClient } from "@langwatch/clickhouse-client";',
          "modules/agent/server/src/repositories/clickhouse/clickhouse.agent.repository.ts",
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
          "modules/agent/server/src/adapters/clickhouse.agent.adapter.ts",
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
          "modules/agent/server/src/adapters/postgres.agent.adapter.ts",
        ),
      ).toEqual(["clickhouseClient"]);
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
    /** @scenario "An application config file is still governed" */
    it("reports clickhouseClient", () => {
      expect(
        ids(
          'import { parseRoutingTable } from "@langwatch/clickhouse-client";',
          "apps/api/src/platform/config/api.config.ts",
        ),
      ).toEqual(["clickhouseClient"]);
    });
  });
});

describe("given a members file named by convention", () => {
  describe("when a shared package's member file value-imports the client", () => {
    /** @scenario "A boot members file is allowed wherever it is built" */
    it("reports nothing", () => {
      expect(
        ids(
          'import { createClient } from "@langwatch/clickhouse-client";',
          "packages/infrastructure/src/clickhouse-member.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when a shared package file that is not a member file value-imports the client", () => {
    /** @scenario "A shared package outside the boot seam is still governed" */
    it("reports clickhouseClient", () => {
      expect(
        ids(
          'import { PLATFORM_TENANT } from "@langwatch/clickhouse-client";',
          "packages/infrastructure/src/tenant-directory.ts",
        ),
      ).toEqual(["clickhouseClient"]);
    });
  });
});

describe("given a re-export or dynamic import", () => {
  describe("when a value is re-exported from the client", () => {
    /** @scenario "Re-exporting a client value is reported" */
    it("reports clickhouseClient", () => {
      expect(
        ids('export { PLATFORM_TENANT } from "@langwatch/clickhouse-client";'),
      ).toEqual(["clickhouseClient"]);
    });
  });

  describe("when only a type is re-exported from the client", () => {
    /** @scenario "Re-exporting a client type is allowed" */
    it("reports nothing", () => {
      expect(
        ids('export type { TenantDirectory } from "@langwatch/clickhouse-client";'),
      ).toEqual([]);
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
          "modules/agent/server/src/__tests__/agent.unit.test.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when the file carries a baseline entry", () => {
    /** @scenario "A file on the debt register is left alone" */
    it("reports nothing", () => {
      expect(
        ids('import { PLATFORM_TENANT } from "@langwatch/clickhouse-client";', BASELINED),
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
