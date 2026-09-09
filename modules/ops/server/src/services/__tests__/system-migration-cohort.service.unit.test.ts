import type { SystemMigration } from "@langwatch/system-migrations";
import { describe, expect, it } from "vitest";
import {
  type OrganizationDataplane,
  OrganizationDataplanePort,
} from "../../ports/organization-dataplane.port.ts";
import { SystemMigrationCohortService } from "../system-migration-cohort.service.ts";

/** The routing table as a fake: organizations it names are on their own instance. */
class FakeDataplanePort extends OrganizationDataplanePort {
  readonly asked: string[] = [];

  constructor(private readonly endpoints: Record<string, string>) {
    super();
  }

  dataplaneFor(organizationId: string): OrganizationDataplane {
    this.asked.push(organizationId);
    const endpoint = this.endpoints[organizationId];
    return endpoint === undefined ? { kind: "shared" } : { kind: "private", endpoint };
  }
}

const migrationOf = (name: string, enrolledAutomatically: boolean): SystemMigration => ({
  name,
  title: name,
  description: "A migration under test.",
  requiresOperatorConfirmation: false,
  runsAutomaticallyOnSelfHosted: true,
  enrolledAutomatically,
  migrateTenant: () => Promise.resolve({ status: "finalized" } as never),
});

const cohortOf = ({
  automatic,
  enrolled = new Map<string, ReadonlySet<string>>(),
  dataplane,
}: {
  automatic: boolean;
  enrolled?: ReadonlyMap<string, ReadonlySet<string>>;
  dataplane: FakeDataplanePort;
}) =>
  SystemMigrationCohortService.create({
    isSaaS: true,
    enrolled,
    migrations: [migrationOf("identity-backfill", automatic)],
    dataplane,
  });

describe("given a cloud installation computing an organization cohort", () => {
  describe("when the migration is declared enrolled automatically", () => {
    /** @scenario "An automatic cohort includes a private-dataplane organization" */
    it("admits an organization on its own data plane, and names the endpoint", () => {
      const dataplane = new FakeDataplanePort({
        org_isolated_inc: "https://clickhouse.isolated.example:8443",
      });

      const admission = cohortOf({ automatic: true, dataplane }).admits({
        organizationId: "org_isolated_inc",
        migrationName: "identity-backfill",
      });

      expect(admission).toEqual({
        admitted: true,
        dataplane: { kind: "private", endpoint: "https://clickhouse.isolated.example:8443" },
      });
      expect(dataplane.asked).toEqual(["org_isolated_inc"]);
    });

    it("admits an organization on the shared instance the same way", () => {
      const admission = cohortOf({
        automatic: true,
        dataplane: new FakeDataplanePort({}),
      }).admits({ organizationId: "org_acme", migrationName: "identity-backfill" });

      expect(admission).toEqual({ admitted: true, dataplane: { kind: "shared" } });
    });
  });

  describe("when the migration is paced by enrollment", () => {
    it("leaves out an organization nobody enrolled, whatever its data plane", () => {
      const dataplane = new FakeDataplanePort({ org_isolated_inc: "https://ch.example:8443" });

      const admission = cohortOf({ automatic: false, dataplane }).admits({
        organizationId: "org_isolated_inc",
        migrationName: "identity-backfill",
      });

      expect(admission.admitted).toBe(false);
    });

    it("admits an organization an operator enrolled, on its own data plane", () => {
      const dataplane = new FakeDataplanePort({ org_isolated_inc: "https://ch.example:8443" });

      const admission = cohortOf({
        automatic: false,
        enrolled: new Map([["identity-backfill", new Set(["org_isolated_inc"])]]),
        dataplane,
      }).admits({ organizationId: "org_isolated_inc", migrationName: "identity-backfill" });

      expect(admission.admitted).toBe(true);
      expect(admission.dataplane).toEqual({
        kind: "private",
        endpoint: "https://ch.example:8443",
      });
    });
  });
});
