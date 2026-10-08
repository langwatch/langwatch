/**
 * Every Postgres table the live tier claims has one owner (ARCHITECTURE.md rule 2); a reader
 * through a share (R40) claims nothing. Boot refuses a double claim before opening any client.
 */
import {
  assertRepositoryOwnership,
  type FeatureRepositories,
  selectedRepositoryOwnership,
} from "@langwatch/process";
import { describe, expect, it } from "vitest";

import { processModules } from "../process-modules.generated.ts";

function liveClaims(): { name: string; repositories: FeatureRepositories }[] {
  return processModules.map((module) => ({
    name: module.name,
    repositories: {
      ...module.repositories,
      ...(module.repositoryRegistry
        ? selectedRepositoryOwnership(module.repositoryRegistry, { tier: "live", members: {} })
        : {}),
    },
  }));
}

describe("the live tier's table claims", () => {
  it("name one owner for every table", () => {
    expect(() => assertRepositoryOwnership(liveClaims())).not.toThrow();
  });

  it("leave Project and Team to their owners when another module reads them", () => {
    const claimants = liveClaims()
      .filter((feature) =>
        Object.values(feature.repositories).some(({ tables }) =>
          tables.tables.some((table) => table === "Project" || table === "Team"),
        ),
      )
      .map((feature) => feature.name);

    expect(claimants).not.toContain("instant-eval-judge");
    expect(claimants).not.toContain("nurturing");
  });
});
