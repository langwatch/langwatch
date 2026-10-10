// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Spec: enterprise/modules/scim/specs/scim-request-log.feature, scim.feature */
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { scimRepositories } from "../../scim-repositories.registry.ts";
import { MemoryScimRepository } from "../memory.scim.repository.ts";

const T0 = Temporal.Instant.from("2026-09-01T00:00:00Z");

function clocked() {
  let at: Instant = T0;
  const repository = MemoryScimRepository.create({ now: () => at });
  return {
    repository,
    advance: (hours: number) => {
      at = at.add({ hours });
    },
  };
}

const request = {
  organizationId: "org_acme",
  connectionId: "conn_1",
  method: "GET",
  resource: "Users",
  status: 200,
  reason: null,
  detail: null,
};

describe("MemoryScimRepository", () => {
  describe("when the memory tier is selected", () => {
    it("is what the registry's memory tier builds", () => {
      expect(scimRepositories.definitions.memory.create().scim).toBeInstanceOf(
        MemoryScimRepository,
      );
    });
  });

  describe("when recorded requests age out", () => {
    /** @scenario "Requests older than the window are dropped" */
    it("finds only the rows before the cut-off and deletes exactly those", async () => {
      const { repository, advance } = clocked();
      await repository.recordRequest(request);
      advance(48);
      await repository.recordRequest({ ...request, resource: "Groups" });

      const expired = await repository.findExpiredRequestIds({
        before: T0.add({ hours: 24 }),
        limit: 10,
      });

      expect(await repository.deleteRequests({ ids: expired })).toBe(1);
      const kept = await repository.findRequestLog({
        organizationId: "org_acme",
        connectionId: "conn_1",
        limit: 10,
      });
      expect(kept.map((row) => row.resource)).toEqual(["Groups"]);
    });
  });

  describe("when a group is looked up by id", () => {
    /** @scenario "A group made in LangWatch is out of a directory token's reach by id" */
    it("finds a pushed group and not one made in LangWatch", async () => {
      const { repository } = clocked();
      const pushed = await repository.createGroup({
        organizationId: "org_acme",
        name: "Pushed",
        slug: "pushed",
        externalId: null,
        connectionId: "conn_1",
      });
      repository.groups.push({ ...pushed, id: "group_made_here", scimSource: null });

      expect(await repository.findGroup({ organizationId: "org_acme", id: pushed.id })).toEqual(
        pushed,
      );
      expect(
        await repository.findGroup({ organizationId: "org_acme", id: "group_made_here" }),
      ).toBeNull();
    });
  });

  describe("when a directory writes a person", () => {
    it("keeps one resource per organization and person, and a deletion is a tombstone", async () => {
      const { repository } = clocked();
      await repository.saveUserResource({
        organizationId: "org_acme",
        userId: "user_1",
        userName: " Ada@Acme.test ",
        name: "Ada",
        active: true,
      });
      await repository.markUserResourceDeleted({
        organizationId: "org_acme",
        userId: "user_1",
        userName: "ada@acme.test",
        name: "Ada",
      });

      expect(repository.resources).toHaveLength(1);
      expect(repository.resources[0]).toMatchObject({
        userName: "ada@acme.test",
        active: false,
      });
      expect(repository.resources[0]!.deletedAt).not.toBeNull();
    });
  });
});
