/**
 * The gate counts ClickHouse targets from the environment the upgrade it triggers runs under:
 * a route at the shared URL folds into "shared" for both.
 * Spec: specs/upgrade/serving-gate.feature.
 */
import { describe, expect, it } from "vitest";

import { configuredClickHouseTargets } from "../../runner/image-upgrade.ts";
import { upgradeEnvironmentOver } from "../serving-upgrade-gate.ts";

const SHARED_URL = "http://clickhouse:8123/langwatch";

describe("upgradeEnvironmentOver", () => {
  describe("given the shared ClickHouse URL is a secret and a route in the environment names it", () => {
    const environment = { NODE_ENV: "production", CLICKHOUSE_URL__acme__org_1: SHARED_URL };
    const databaseUrl = "postgresql://never-opened:5432/langwatch";

    /** @scenario "The gate reads its ClickHouse targets from the environment the upgrade runs under" */
    it("sets both store URLs and reads the route as the shared target", () => {
      const upgradeEnvironment = upgradeEnvironmentOver({
        environment,
        databaseUrl,
        clickhouse: ` ${SHARED_URL} `,
      });

      expect(upgradeEnvironment).toEqual({
        ...environment,
        DATABASE_URL: databaseUrl,
        CLICKHOUSE_URL: SHARED_URL,
      });
      expect(configuredClickHouseTargets({ environment })).toEqual(["private:org_1"]);
      expect(configuredClickHouseTargets({ environment: upgradeEnvironment })).toEqual(["shared"]);
    });

    it("leaves CLICKHOUSE_URL unset when the secret is blank", () => {
      const upgradeEnvironment = upgradeEnvironmentOver({
        environment,
        databaseUrl,
        clickhouse: " ",
      });

      expect(upgradeEnvironment).toEqual({ ...environment, DATABASE_URL: databaseUrl });
    });

    /** @scenario "The gate reads its ClickHouse targets from the environment the upgrade runs under" */
    it("counts a route at another URL as its own private target", () => {
      const privateEnvironment = {
        CLICKHOUSE_URL__acme__org_1: "http://private-clickhouse:8123/langwatch",
      };

      const upgradeEnvironment = upgradeEnvironmentOver({
        environment: privateEnvironment,
        databaseUrl,
        clickhouse: SHARED_URL,
      });

      expect(configuredClickHouseTargets({ environment: upgradeEnvironment })).toEqual([
        "shared",
        "private:org_1",
      ]);
    });
  });
});
