/**
 * @vitest-environment jsdom
 * The cost screen announces its open, and only to someone the section lets in.
 * @see enterprise/modules/nurturing/specs/app-opened.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GovernanceHostProvider } from "../../../../model/governance-host.ts";
import { fakeGovernanceHost } from "../../../../testing.tsx";
import CostsScreen from "../governance-costs.screen.tsx";

const recordPageOpened = vi.hoisted(() => vi.fn());

vi.mock("@langwatch/auth-client", () => ({ useRecordPageOpened: recordPageOpened }));
vi.mock("../../../../features/costs/ui/sections/costs-page.tsx", () => ({
  default: () => <div data-testid="costs-page" />,
}));

function renderCosts(host: ReturnType<typeof fakeGovernanceHost>) {
  renderWithDesignSystem(
    <GovernanceHostProvider value={host}>
      <CostsScreen />
    </GovernanceHostProvider>,
  );
}

beforeEach(() => recordPageOpened.mockClear());
afterEach(() => cleanup());

describe("the cost screen", () => {
  describe("when someone with the grant opens it", () => {
    /** @scenario "Each usage, cost or plan screen announces its open through the page-opened mutation" */
    it("records the cost page as opened", () => {
      renderCosts(fakeGovernanceHost({ permissions: ["governanceCost:view"] }));

      expect(screen.getByTestId("costs-page")).toBeTruthy();
      expect(recordPageOpened.mock.calls).toEqual([[{ page: "governance_costs" }]]);
    });
  });

  describe("when someone without the grant opens it", () => {
    it("records nothing", () => {
      renderCosts(fakeGovernanceHost({ permissions: [] }));

      expect(recordPageOpened).not.toHaveBeenCalled();
    });
  });
});
