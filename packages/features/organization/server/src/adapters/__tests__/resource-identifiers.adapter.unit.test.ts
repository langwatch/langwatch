import { describe, expect, it } from "vitest";
import {
  GroupIdentityAdapter,
  PersonalWorkspaceIdentityAdapter,
  TeamIdentityAdapter,
} from "../resource-identifiers.adapter";

/**
 * Every value asserted below is written into a row the customer then owns, so
 * each assertion pins a persisted format rather than a preference. The KSUID
 * prefixes in particular are what the platform application has always minted;
 * a second composition root that spelled one differently would write rows
 * nothing else recognises.
 */
describe("PersonalWorkspaceIdentityAdapter", () => {
  describe("when a personal workspace is created", () => {
    /** @scenario "A personal workspace is born with packaged identifiers" */
    it("mints the resource-prefixed identifiers the platform has always written", () => {
      const resources = PersonalWorkspaceIdentityAdapter.create().create({
        userId: "USER_ABCDEFGHIJKLMNOP",
        organizationId: "organization_1",
      });

      expect(resources.teamId).toMatch(/^team_/);
      expect(resources.projectId).toMatch(/^project_/);
      expect(resources.ownerBindingId).toMatch(/^rolebinding_/);
      expect(resources.projectApiKey).toMatch(/^pkey_.{40}$/);
    });

    /** @scenario "A personal workspace is born with packaged identifiers" */
    it("seeds both slugs from the lower-cased first twelve characters of the user id", () => {
      const resources = PersonalWorkspaceIdentityAdapter.create().create({
        userId: "USER_ABCDEFGHIJKLMNOP",
        organizationId: "organization_1",
      });

      expect(resources.teamSlug).toMatch(/^personal-user_abcdefg-[0-9a-z_-]{6}$/);
      expect(resources.projectSlug).toMatch(/^personal-user_abcdefg-[0-9a-z_-]{6}$/);
    });

    /** @scenario "A personal workspace is born with packaged identifiers" */
    it("gives the team and the project separate slugs", () => {
      const resources = PersonalWorkspaceIdentityAdapter.create().create({
        userId: "user_1",
        organizationId: "organization_1",
      });

      expect(resources.teamSlug).not.toBe(resources.projectSlug);
    });

    /** @scenario "A personal workspace is born with packaged identifiers" */
    it("mints a distinct set for every call", () => {
      const adapter = PersonalWorkspaceIdentityAdapter.create();
      const input = { userId: "user_1", organizationId: "organization_1" };

      const first = adapter.create(input);
      const second = adapter.create(input);

      expect(first.teamId).not.toBe(second.teamId);
      expect(first.projectId).not.toBe(second.projectId);
      expect(first.ownerBindingId).not.toBe(second.ownerBindingId);
      expect(first.projectApiKey).not.toBe(second.projectApiKey);
    });
  });
});

describe("TeamIdentityAdapter", () => {
  describe("when a shared team is created", () => {
    /** @scenario "A shared team is born with packaged identifiers" */
    it("mints the nanoid team id shape the Team rows already carry", () => {
      const { teamId } = TeamIdentityAdapter.create().createTeam({ name: "Platform" });

      expect(teamId).toMatch(/^team_[A-Za-z0-9_-]{21}$/);
    });

    /** @scenario "A shared team is born with packaged identifiers" */
    it("suffixes the slug with the first eleven characters of the team id", () => {
      const { teamId, slug } = TeamIdentityAdapter.create().createTeam({ name: "Platform" });

      expect(slug).toBe(`platform-${teamId.substring(0, 11)}`);
    });

    /** @scenario "A team or group slug survives a URL" */
    it("reduces separators, accents and symbols to a single dash-joined ASCII word", () => {
      const { teamId, slug } = TeamIdentityAdapter.create().createTeam({
        name: "Crème_Brûlée: R&D?",
      });

      expect(slug).toBe(`creme-brulee-r-d-${teamId.substring(0, 11)}`);
    });
  });

  describe("when a role binding is minted for a team", () => {
    /** @scenario "A shared team is born with packaged identifiers" */
    it("uses the same rolebinding resource every other binding carries", () => {
      const adapter = TeamIdentityAdapter.create();

      expect(adapter.createBindingId()).toMatch(/^rolebinding_/);
      expect(adapter.createBindingId()).not.toBe(adapter.createBindingId());
    });
  });
});

describe("GroupIdentityAdapter", () => {
  describe("when a group is created", () => {
    /** @scenario "An organization group is born with packaged identifiers" */
    it("mints a group-prefixed KSUID", () => {
      const adapter = GroupIdentityAdapter.create();

      expect(adapter.createGroupId()).toMatch(/^group_/);
      expect(adapter.createGroupId()).not.toBe(adapter.createGroupId());
    });

    /** @scenario "An organization group is born with packaged identifiers" */
    it("mints role bindings under the shared rolebinding resource", () => {
      expect(GroupIdentityAdapter.create().createBindingId()).toMatch(/^rolebinding_/);
    });

    /** @scenario "A team or group slug survives a URL" */
    it("returns a base slug with no identifier tail for the service to disambiguate", () => {
      expect(GroupIdentityAdapter.create().slugify("Crème_Brûlée: R&D?")).toBe("creme-brulee-r-d");
    });

    /** @scenario "A team or group slug survives a URL" */
    it("slugs a name identically for a group and for a team", () => {
      const { teamId, slug } = TeamIdentityAdapter.create().createTeam({
        name: "Platform Engineering",
      });

      expect(GroupIdentityAdapter.create().slugify("Platform Engineering")).toBe(
        "platform-engineering",
      );
      expect(slug).toBe(`platform-engineering-${teamId.substring(0, 11)}`);
    });
  });
});
