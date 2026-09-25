// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Main's `governancePeopleScreen.service.ts`, over memory repositories. */
import { createApiFixture } from "@langwatch/api-fixture";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryDepartmentRepository } from "../../repositories/memory/memory.department.repository.ts";
import { MemoryDiscoveredPeopleStore } from "../../repositories/memory/memory.discovered-people.store.ts";
import { MemoryDiscoveredPersonRepository } from "../../repositories/memory/memory.discovered-person.repository.ts";
import { MemoryGovernanceStore } from "../../repositories/memory/memory.governance.store.ts";
import { MemoryIdentityMatchSuggestionRepository } from "../../repositories/memory/memory.identity-match-suggestion.repository.ts";
import { MemoryIdentityMatchRepository } from "../../repositories/memory/memory.identity-match.repository.ts";
import { DepartmentService } from "../department.service.ts";
import { GovernancePeopleScreenService } from "../governance-people-screen.service.ts";

const ORG = "org_1";
const SEEN = Temporal.Instant.from("2026-09-01T00:00:00Z");

function person(id: string, displayText: string) {
  return {
    id,
    organizationId: ORG,
    provider: "anthropic",
    rawActorId: `actor_${id}`,
    displayText,
    kind: "user",
    department: null,
    firstSeenAt: SEEN,
    lastSeenAt: SEEN,
    erasedAt: null,
    moneyRowsPendingAt: null,
    moneyRebuildSince: null,
    suspendedAt: null,
    suspendedReason: null,
  };
}

async function setup() {
  const people = MemoryDiscoveredPeopleStore.create();
  const departments = DepartmentService.create({
    repository: MemoryDepartmentRepository.create(MemoryGovernanceStore.create()),
    organizations: createApiFixture<OrganizationApi>({}),
    projects: createApiFixture<ProjectApi>({}),
  });
  const research = await departments.create({ organizationId: ORG, name: "Research" });
  people.people.push(person("p_linked", "ada@example.com"), person("p_open", "grace"));
  people.matches.push({
    id: "m_1",
    organizationId: ORG,
    discoveredPersonId: "p_linked",
    userId: "user_ada",
    evidenceKind: "verified_email",
    validFrom: SEEN,
    validTo: null,
  });
  people.suggestions.push(
    {
      id: "s_1",
      organizationId: ORG,
      discoveredPersonId: "p_open",
      userId: "user_nameless",
      score: 0.9,
      computedAt: SEEN,
    },
    {
      id: "s_gone",
      organizationId: ORG,
      discoveredPersonId: "p_erased",
      userId: "user_ada",
      score: 0.5,
      computedAt: SEEN,
    },
  );
  const organizations = createApiFixture<OrganizationApi>({
    findMembersWithDepartments: async () => [
      {
        userId: "user_ada",
        departmentId: research.id,
        user: { name: "Ada", email: "ada@example.com" },
      },
      {
        userId: "user_nameless",
        departmentId: null,
        user: { name: null, email: "anon@example.com" },
      },
    ],
  });
  const service = GovernancePeopleScreenService.create({
    discoveredPeople: MemoryDiscoveredPersonRepository.create(people),
    matches: MemoryIdentityMatchRepository.create(people),
    suggestions: MemoryIdentityMatchSuggestionRepository.create(people),
    departments,
    organizations,
  });
  return { service };
}

describe("GovernancePeopleScreenService", () => {
  describe("when the people are listed", () => {
    it("joins each open link to the member's name and department", async () => {
      const { service } = await setup();

      const listed = await service.listPeople({ organizationId: ORG });

      expect(listed.find((p) => p.id === "p_linked")?.link).toEqual({
        userId: "user_ada",
        evidenceKind: "verified_email",
        memberName: "Ada",
        departmentName: "Research",
      });
      expect(listed.find((p) => p.id === "p_open")?.link).toBeNull();
      expect(listed[0]?.lastSeenAt).toEqual(new Date("2026-09-01T00:00:00Z"));
    });
  });

  describe("when the suggestions are listed", () => {
    it("names the member by address when they have no name and drops a person who is gone", async () => {
      const { service } = await setup();

      await expect(service.listSuggestions({ organizationId: ORG })).resolves.toEqual([
        {
          id: "s_1",
          discoveredPersonId: "p_open",
          personDisplayText: "grace",
          personProvider: "anthropic",
          userId: "user_nameless",
          memberName: "anon@example.com",
          score: 0.9,
        },
      ]);
    });
  });
});
