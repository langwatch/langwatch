/**
 * @vitest-environment jsdom
 *
 * Members in organizations with no project are never teleported elsewhere.
 * @see specs/navigation/navigation-v2-landing.feature
 */

import { describe, expect, it } from "vitest";
import type { OrganizationReading } from "../../model/organization-host.ts";
import { FakeOrganizationHost, renderWithOrganizationHost } from "../../testing.tsx";
import { useOrganizationTeamProject } from "../use-organization-team-project.ts";

/** The ambient organization: one team, and not a single project in it. */
const EMPTY_ORGANIZATION: OrganizationReading = {
  id: "org-empty",
  name: "Empty Org",
  teams: [{ id: "team-empty", name: "Empty Team", slug: "empty-team", projects: [] }],
};

function ReadsContext({ onRead }: { onRead: (id: string | undefined) => void }) {
  const { organization } = useOrganizationTeamProject({ redirectToOnboarding: true });
  onRead(organization?.id);
  return null;
}

describe("given a member whose organization holds no project", () => {
  describe("when the application resolves their context", () => {
    /** @scenario A member kept in an empty organization stays put */
    it("keeps them in that organization and starts no navigation", () => {
      const reads: (string | undefined)[] = [];
      const { host } = renderWithOrganizationHost(
        <ReadsContext onRead={(id) => reads.push(id)} />,
        new FakeOrganizationHost({
          organization: EMPTY_ORGANIZATION,
          activeProject: void 0,
        }),
      );

      expect(reads.at(-1)).toBe("org-empty");
      expect(host.navigations).toEqual([]);
    });
  });
});
