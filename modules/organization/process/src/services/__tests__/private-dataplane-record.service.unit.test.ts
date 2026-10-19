/**
 * @see specs/private-dataplane/clickhouse-routing.feature, "Recorded private organizations"
 * The organization module records each privately routed organization the first time it is seen.
 */
import type { PrivateRouteVariable } from "@langwatch/clickhouse-client";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import { MemoryOrganizationRepository } from "../../repositories/memory/memory.organization.repository.ts";
import { PrivateClickHouseRoutesRepository } from "../../repositories/private-clickhouse-routes.repository.ts";
import { PrivateS3AccountsRepository } from "../../repositories/private-s3-accounts.repository.ts";
import { PrivateDataplaneRecordService } from "../private-dataplane-record.service.ts";

class FixedRoutes extends PrivateClickHouseRoutesRepository {
  constructor(public variables: PrivateRouteVariable[]) {
    super();
  }

  findRouteVariables(): readonly PrivateRouteVariable[] {
    return this.variables;
  }
}

class FixedAccounts extends PrivateS3AccountsRepository {
  constructor(public variables: PrivateRouteVariable[]) {
    super();
  }

  findAccountVariables(): readonly PrivateRouteVariable[] {
    return this.variables;
  }
}

const present = (prefix: string, label: string, organizationId: string): PrivateRouteVariable => ({
  organizationId,
  label,
  variable: `${prefix}${label}__${organizationId}`,
  state: "present",
});

function seeded(...ids: string[]): MemoryOrganizationDatabase {
  const database = MemoryOrganizationDatabase.create();
  const now = nowInstant();
  for (const id of ids) {
    database.organizations.set(id, {
      id,
      name: id,
      slug: id,
      supportContact: null,
      presenceEnabled: false,
      traceSharingEnabled: false,
      primaryIntent: null,
      s3Endpoint: null,
      s3AccessKeyId: null,
      s3SecretAccessKey: null,
      s3Bucket: null,
      stripeCustomerId: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  return database;
}

describe("PrivateDataplaneRecordService", () => {
  describe("given an organization routed to its own ClickHouse and S3", () => {
    /** @scenario "The organization module records a private route the first time it sees it, once" */
    it("records both labels once, and a later label never replaces the first", async () => {
      const database = seeded("org123", "org456");
      const routes = new FixedRoutes([present("CLICKHOUSE_URL__", "acme", "org123")]);
      const accounts = new FixedAccounts([present("DATAPLANE_S3__", "acme", "org123")]);
      const service = PrivateDataplaneRecordService.create({
        routes,
        accounts,
        organizations: MemoryOrganizationRepository.create({ memory: database }),
      });

      await expect(service.recordSeen()).resolves.toEqual({ organizations: 1 });
      routes.variables = [present("CLICKHOUSE_URL__", "renamed", "org123")];
      await service.recordSeen();

      expect(database.organizations.get("org123")).toMatchObject({
        privateClickHouseLabel: "acme",
        privateS3Label: "acme",
      });
      expect(database.organizations.get("org456")?.privateClickHouseLabel).toBeUndefined();
    });

    it("records nothing for a variable that did not parse", async () => {
      const database = seeded("org123");
      const service = PrivateDataplaneRecordService.create({
        routes: new FixedRoutes([
          { ...present("CLICKHOUSE_URL__", "acme", "org123"), state: "malformed" },
        ]),
        accounts: new FixedAccounts([]),
        organizations: MemoryOrganizationRepository.create({ memory: database }),
      });

      await expect(service.recordSeen()).resolves.toEqual({ organizations: 0 });
      expect(database.organizations.get("org123")?.privateClickHouseLabel).toBeUndefined();
    });
  });
});
