/**
 * @vitest-environment jsdom
 *
 * The remembered answer to "how should Langy reach my code" shows on the Integrations screen
 * (it fills that screen's slot) and can be taken back there. The choice is made in the chat, so
 * the line only exists once one is stored: a settings page that offers to change a choice
 * nobody made is noise.
 *
 * @see specs/langy/langy-code-access.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const preference = vi.hoisted(() => ({ current: null as "github" | null }));
const clearPreference = vi.hoisted(() => vi.fn());

vi.mock("../../../behavior/langy-api", () => ({
  api: {
    langy: {
      getCodeAccessPreference: {
        useQuery: () => ({
          data: { preference: preference.current },
          refetch: vi.fn(),
        }),
      },
      setCodeAccessPreference: {
        useMutation: () => ({ mutate: clearPreference, isPending: false }),
      },
    },
  },
}));

vi.mock("../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1", name: "Acme Corp" },
    project: { id: "p_1", slug: "acme" },
  }),
}));

import { LangyCodeAccessPreference } from "../langy-code-access-preference";

afterEach(cleanup);
beforeEach(() => clearPreference.mockClear());

const renderBlock = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <LangyCodeAccessPreference />
    </ChakraProvider>,
  );

describe("given GitHub was remembered for code changes", () => {
  beforeEach(() => {
    preference.current = "github";
  });

  /** @scenario "The remembered choice can be cleared from the integrations settings" */
  it("says so in the GitHub section, and clears the choice", () => {
    renderBlock();

    expect(screen.getByText("Langy uses GitHub for code changes")).toBeDefined();
    fireEvent.click(screen.getByText("Change"));

    expect(clearPreference).toHaveBeenCalledWith({
      projectId: "p_1",
      preference: null,
    });
  });
});

describe("given nothing was remembered", () => {
  beforeEach(() => {
    preference.current = null;
  });

  it("says nothing, because there is no choice to change", () => {
    renderBlock();
    expect(screen.queryByText("Langy uses GitHub for code changes")).toBeNull();
  });
});
