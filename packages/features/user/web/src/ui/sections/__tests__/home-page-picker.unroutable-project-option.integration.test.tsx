/**
 * @vitest-environment jsdom
 *
 * The picker's "Project home" option must name the same project the resolver
 * would actually route to. `homePagePickerState.firstProjectSlug` is an
 * UNFILTERED query and can name a personal workspace; `governance.resolveHome`
 * excludes those outright (ADR-038 v6). Offering the unfiltered slug would pin
 * a destination "Auto" could never reach.
 *
 * Spec: specs/ai-gateway/governance/persona-home-content.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const stateData = {
  data: { lastHomePath: null as string | null, firstProjectSlug: "personal-alex" },
  isLoading: false,
};
const resolverData = {
  data: { persona: "mixed", firstProjectSlug: null as string | null },
  isLoading: false,
};

vi.mock("../../../behavior/personal-workspace-feedback", () => ({
  useShowErrorToast: () => () => {},
}));

vi.mock("../../../behavior/personal-workspace-api", () => ({
  api: {
    user: {
      homePagePickerState: { useQuery: () => stateData },
      setLastHomePath: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
    },
    governance: { resolveHome: { useQuery: () => resolverData } },
    useUtils: () => ({
      user: { homePagePickerState: { invalidate: () => {} } },
      governance: { resolveHome: { invalidate: () => {} } },
    }),
  },
}));

import { HomePagePicker } from "../home-page-picker";

afterEach(cleanup);

describe("given the resolver excludes the caller's only project as a personal workspace", () => {
  describe("when the picker builds its options", () => {
    /** @scenario The picker's "Project home" option never names a personal workspace */
    it("offers no Project home option, even though the unfiltered query names one", () => {
      resolverData.data = { persona: "personal_only", firstProjectSlug: null };
      render(
        <ChakraProvider value={defaultSystem}>
          <HomePagePicker organizationId="org_1" />
        </ChakraProvider>,
      );

      expect(screen.getByText("Auto")).toBeTruthy();
      expect(screen.getByText("Personal home")).toBeTruthy();
      expect(screen.queryByText("Project home")).toBeNull();
    });
  });
});

describe("given the resolver's own project differs from the unfiltered query", () => {
  describe("when the picker builds its options", () => {
    it("names the resolver's project, not the unfiltered one", () => {
      stateData.data = { lastHomePath: null, firstProjectSlug: "personal-alex" };
      resolverData.data = { persona: "mixed", firstProjectSlug: "team-prod" };
      render(
        <ChakraProvider value={defaultSystem}>
          <HomePagePicker organizationId="org_1" />
        </ChakraProvider>,
      );

      expect(screen.getByText("Always land on /team-prod/traces")).toBeTruthy();
      expect(screen.queryByText("Always land on /personal-alex/traces")).toBeNull();
    });
  });
});
