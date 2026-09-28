import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { tasksSecrets } from "../config.ts";
import { openSystemMigrationsDataplane } from "../system-migrations-dataplane.ts";

function dataplaneOver(environment: Record<string, string>) {
  const resolver = SecretsResolver.over(SecretsChain.start({ environment }).withEnv());
  return openSystemMigrationsDataplane(resolver.scopeTo("tasks", Object.values(tasksSecrets)));
}

describe("given the migration runner's dataplane", () => {
  describe("when the deployment names an organization's own ClickHouse", () => {
    /** @scenario "The migration runner reads the stores' parse of the route family" */
    it("answers that organization as private and any other as shared", async () => {
      const dataplane = await dataplaneOver({
        CLICKHOUSE_URL__acme__org_1: "http://private.invalid:8123",
      });

      expect(dataplane.dataplaneFor("org_1").kind).toBe("private");
      expect(dataplane.dataplaneFor("org_2")).toEqual({ kind: "shared" });
    });
  });
});
