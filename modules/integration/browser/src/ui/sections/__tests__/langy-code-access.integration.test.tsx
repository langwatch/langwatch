/**
 * @vitest-environment jsdom
 *
 * The remembered code-access choice shows on the Integrations screen only once one is stored:
 * a settings page offering to change a choice nobody made is noise.
 * @see specs/langy/langy-code-access.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const preference = vi.hoisted(() => ({ current: null as "github" | null }));
const clearPreference = vi.hoisted(() => vi.fn());

vi.mock("../../../behavior/langy-api.ts", () => ({
  langyApi: {
    langy: {
      getCodeAccessPreference: {
        useQuery: () => ({ data: { preference: preference.current }, refetch: vi.fn() }),
      },
      setCodeAccessPreference: {
        useMutation: () => ({ mutate: clearPreference, isPending: false }),
      },
    },
  },
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1", name: "Acme Corp" },
    project: { id: "p_1", slug: "acme" },
  }),
}));

import { LangyCodeAccess } from "../langy-code-access.tsx";

afterEach(cleanup);
beforeEach(() => clearPreference.mockClear());

const renderSection = () => renderWithDesignSystem(<LangyCodeAccess />);

describe("given GitHub was remembered for code changes", () => {
  beforeEach(() => {
    preference.current = "github";
  });

  /** @scenario "The remembered choice can be cleared from the integrations settings" */
  it("says so, and clears the choice for this project", () => {
    renderSection();

    expect(screen.getByText("Langy uses GitHub for code changes")).toBeDefined();
    fireEvent.click(screen.getByText("Change"));

    expect(clearPreference).toHaveBeenCalledWith({ projectId: "p_1", preference: null });
  });
});

describe("given nothing was remembered", () => {
  beforeEach(() => {
    preference.current = null;
  });

  it("says nothing, because there is no choice to change", () => {
    renderSection();
    expect(screen.queryByText("Langy uses GitHub for code changes")).toBeNull();
  });
});
