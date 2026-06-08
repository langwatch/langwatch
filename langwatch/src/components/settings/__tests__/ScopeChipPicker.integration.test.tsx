/**
 * @vitest-environment jsdom
 *
 * Guards the scope quick-picks against bypassing `allowedScopeTypes`.
 * The tile catalog offers ORGANIZATION + DEPARTMENT only, so the Team /
 * Project quick-pick chips must never render even when the current team /
 * project ids are supplied - otherwise a quick-pick could emit a scope kind
 * the caller explicitly disallowed.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScopeChipPicker } from "../ScopeChipPicker";

function renderPicker(node: ReactNode) {
  return render(<ChakraProvider value={defaultSystem}>{node}</ChakraProvider>);
}

describe("ScopeChipPicker quick-picks", () => {
  afterEach(cleanup);

  describe("given allowedScopeTypes restricts to org + department", () => {
    it("omits the team and project quick-picks even when their ids are set", () => {
      renderPicker(
        <ScopeChipPicker
          value={[]}
          onChange={vi.fn()}
          organizationId="org-1"
          allowedScopeTypes={["ORGANIZATION", "DEPARTMENT"]}
          singleSelect
          currentOrganizationId="org-1"
          currentTeamId="team-1"
          currentProjectId="proj-1"
        />,
      );

      expect(screen.queryByTestId("quick-scope-organization")).not.toBeNull();
      expect(screen.queryByTestId("quick-scope-team")).toBeNull();
      expect(screen.queryByTestId("quick-scope-project")).toBeNull();
    });
  });

  describe("given the default model-provider triad", () => {
    it("offers org, team and project quick-picks", () => {
      renderPicker(
        <ScopeChipPicker
          value={[]}
          onChange={vi.fn()}
          organizationId="org-1"
          singleSelect
          currentOrganizationId="org-1"
          currentTeamId="team-1"
          currentProjectId="proj-1"
        />,
      );

      expect(screen.queryByTestId("quick-scope-organization")).not.toBeNull();
      expect(screen.queryByTestId("quick-scope-team")).not.toBeNull();
      expect(screen.queryByTestId("quick-scope-project")).not.toBeNull();
    });
  });
});
