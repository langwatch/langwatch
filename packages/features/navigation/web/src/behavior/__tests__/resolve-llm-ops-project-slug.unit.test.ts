/**
 * Which project LLM Ops opens when the ambient one cannot be it: the Me
 * pages resolve the personal workspace, and a reader who has just switched
 * organization has nothing remembered at all.
 *
 * MOVED from `platform/app`, where the function decided for itself which teams
 * the reader could open by calling that application's `userCanOpenTeam`. The
 * host answers that now, so the cases that used to turn on an organization ROLE
 * turn on which teams the host offered — which is the same question asked at the
 * seam that owns it.
 *
 * Spec: specs/navigation/product-switcher-navigation.feature
 */
import { describe, expect, it } from "vitest";
import type { NavigationTeam } from "../../model/navigation-host";
import { resolveLlmOpsProjectSlug } from "../use-llm-ops-project-slug";

function team(
  id: string,
  slugs: string[],
  { isPersonal = false }: { isPersonal?: boolean } = {},
): NavigationTeam {
  return {
    id,
    name: id,
    isPersonal,
    projects: slugs.map((slug) => ({ id: `p-${slug}`, name: slug, slug })),
  };
}

const OWN_TEAM = team("own", ["acme-app", "acme-labs"]);
const OTHER_TEAM = team("other", ["platform-app"]);
const PERSONAL_TEAM = team("personal", ["personal-mia-abc123"], { isPersonal: true });

/** What the host offers a MEMBER: their own teams, ambient order first. */
const MEMBER_REACH = [OWN_TEAM, PERSONAL_TEAM];
/** What the host offers an ADMIN: every team of the organization. */
const ADMIN_REACH = [OWN_TEAM, OTHER_TEAM, PERSONAL_TEAM];

function resolve({
  ambientProject,
  rememberedProjectSlug = "",
  openableTeams = MEMBER_REACH,
}: {
  ambientProject?: { slug: string; isPersonal?: boolean };
  rememberedProjectSlug?: string;
  openableTeams?: readonly NavigationTeam[];
}) {
  return resolveLlmOpsProjectSlug({ ambientProject, rememberedProjectSlug, openableTeams });
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
        resolve({ ambientProject: { slug: "personal-mia-abc123", isPersonal: true } }),
      ).toBe("acme-app");
    });
  });

  describe("given the remembered project is in a team the host did not offer", () => {
    it("ignores it and opens a team they are on", () => {
      expect(resolve({ rememberedProjectSlug: "platform-app" })).toBe("acme-app");
    });

    it("keeps it when the host offers every team, as it does for an admin", () => {
      expect(
        resolve({ rememberedProjectSlug: "platform-app", openableTeams: ADMIN_REACH }),
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
      expect(resolve({ openableTeams: [team("own", [])] })).toBeNull();
    });

    it("reports no home when the organization has no team at all", () => {
      expect(resolve({ openableTeams: [] })).toBeNull();
    });
  });
});
