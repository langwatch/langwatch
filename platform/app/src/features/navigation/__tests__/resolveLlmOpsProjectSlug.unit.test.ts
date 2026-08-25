/**
 * Which project LLM Ops opens when the ambient one cannot be it: the Me
 * pages resolve the personal workspace, and a reader who has just switched
 * organization has nothing remembered at all.
 *
 * Spec: specs/navigation/product-switcher-navigation.feature
 */
import { describe, expect, it } from "vitest";
import { OrganizationUserRole } from "~/generated/prisma/client";
import { resolveLlmOpsProjectSlug } from "../useLlmOpsProjectSlug";

const USER_ID = "user-mia";

const OWN_TEAM = {
  isPersonal: false,
  members: [{ userId: USER_ID }],
  projects: [{ slug: "acme-app" }, { slug: "acme-labs" }],
};

const OTHER_TEAM = {
  isPersonal: false,
  members: [{ userId: "user-someone-else" }],
  projects: [{ slug: "platform-app" }],
};

const PERSONAL_TEAM = {
  isPersonal: true,
  members: [{ userId: USER_ID }],
  projects: [{ slug: "personal-mia-abc123" }],
};

function resolve({
  ambientProject,
  rememberedProjectSlug = "",
  teams = [OTHER_TEAM, OWN_TEAM, PERSONAL_TEAM],
  organizationRole = OrganizationUserRole.MEMBER,
}: {
  ambientProject?: { slug: string; isPersonal?: boolean };
  rememberedProjectSlug?: string;
  teams?: {
    isPersonal: boolean;
    members: { userId: string }[];
    projects: { slug: string }[];
  }[];
  organizationRole?: OrganizationUserRole;
}) {
  return resolveLlmOpsProjectSlug({
    ambientProject,
    rememberedProjectSlug,
    teams,
    userId: USER_ID,
    organizationRole,
  });
}

describe("resolveLlmOpsProjectSlug", () => {
  describe("given the reader is on an LLM Ops page", () => {
    it("opens the project that page is about", () => {
      expect(resolve({ ambientProject: { slug: "acme-labs" } })).toBe("acme-labs");
    });
  });

  describe("given the ambient project is the personal workspace", () => {
    it("opens the project the reader last had open", () => {
      expect(
        resolve({
          ambientProject: { slug: "personal-mia-abc123", isPersonal: true },
          rememberedProjectSlug: "acme-labs",
        }),
      ).toBe("acme-labs");
    });

    it("opens a project of a team the reader is on when nothing is remembered", () => {
      expect(
        resolve({
          ambientProject: { slug: "personal-mia-abc123", isPersonal: true },
        }),
      ).toBe("acme-app");
    });
  });

  describe("given the remembered project is one the reader cannot open", () => {
    it("ignores it and opens a team they are on", () => {
      expect(resolve({ rememberedProjectSlug: "platform-app" })).toBe("acme-app");
    });

    it("keeps it for an organization admin, who can open every team", () => {
      expect(
        resolve({
          rememberedProjectSlug: "platform-app",
          organizationRole: OrganizationUserRole.ADMIN,
        }),
      ).toBe("platform-app");
    });
  });

  describe("given the remembered project is the personal one", () => {
    it("opens a project of the organization instead", () => {
      expect(resolve({ rememberedProjectSlug: "personal-mia-abc123" })).toBe("acme-app");
    });
  });

  describe("given no team the reader can open holds a project", () => {
    it("reports no home, so the product can be greyed out", () => {
      expect(resolve({ teams: [OTHER_TEAM, { ...OWN_TEAM, projects: [] }] })).toBeNull();
    });

    it("reports no home when the organization has no team at all", () => {
      expect(resolve({ teams: [] })).toBeNull();
    });
  });
});
