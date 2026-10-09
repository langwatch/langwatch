/**
 * Boot's table-ownership check over every module the tasks process installs, per tier.
 * @vitest-environment node
 * @see specs/architecture/installed-table-claims.feature
 */
import {
  assertRepositoryOwnership,
  selectedRepositoryOwnership,
  type AnyRepositoryRegistry,
  type FeatureRepositories,
} from "@langwatch/process";
import { describe, expect, it } from "vitest";

import { processModules } from "../process-modules.generated.ts";

type Tier = "live" | "memory";

/** The two declarations boot reads a module's table claims from (application.ts). */
type InstalledClaims = Readonly<{
  name: string;
  repositories?: FeatureRepositories;
  repositoryRegistry?: AnyRepositoryRegistry;
}>;

const installed: readonly InstalledClaims[] = processModules;

/** The claims boot asserts for one tier: the module's own, then its registry's chosen tier. */
function claimsFor({ modules, tier }: { modules: readonly InstalledClaims[]; tier: Tier }) {
  return modules.map((module) => ({
    name: module.name,
    repositories: {
      ...module.repositories,
      ...(module.repositoryRegistry
        ? selectedRepositoryOwnership(module.repositoryRegistry, { tier, members: {} })
        : {}),
    },
  }));
}

function caught(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return void 0;
}

describe("installed table claims", () => {
  describe.each<Tier>(["live", "memory"])("when the %s tier's claims are checked", (tier) => {
    /** @scenario "Every installed module's <tier> tier claims each table once" */
    it("finds no table claimed by two modules", () => {
      expect(caught(() => assertRepositoryOwnership(claimsFor({ modules: installed, tier })))).toBe(
        void 0,
      );
    });
  });

  describe("when one more module claims a table an installed module owns", () => {
    /** @scenario "A table claimed by two installed modules fails naming the table and both claimants" */
    it("fails naming the store, the table and both claimants", () => {
      const intruder: InstalledClaims = {
        name: "intruder",
        repositories: { projects: { tables: { store: "prisma", tables: ["Project"] } } },
      };

      const error = caught(() =>
        assertRepositoryOwnership(claimsFor({ modules: [...installed, intruder], tier: "live" })),
      );

      expect(error).toMatchObject({
        name: "RepositoryOwnershipConflictError",
        store: "postgres",
        table: "Project",
        owners: ["project", "intruder"],
      });
    });
  });
});
