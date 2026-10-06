/**
 * @vitest-environment jsdom
 *
 * How the toolbar divides its row: lens tabs grow, the right cluster does not.
 * @see specs/traces-v2/trace-table.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { useExplorerStore } from "../../../../../behavior/explorer.store.ts";
import { Toolbar } from "../toolbar.tsx";

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "acme" },
    hasPermission: () => true,
  }),
}));
vi.mock("../../../../../behavior/explorer/use-project-has-traces.ts", () => ({
  useProjectHasTraces: () => ({ hasAnyTraces: true }),
}));
vi.mock("../../../../../behavior/trace-drawer.ts", () => ({
  useDismissTraceDrawer: () => vi.fn(),
}));
vi.mock("../../hooks/use-error-count.ts", () => ({ useErrorCount: () => ({ count: 0 }) }));
vi.mock("../../hooks/use-is-new-account.ts", () => ({ useIsNewAccount: () => false }));
vi.mock("../../onboarding/hooks/use-trace-explorer-tour-preference.ts", () => ({
  useTraceExplorerTourPreference: () => ({ dismiss: vi.fn() }),
}));
vi.mock("../../onboarding/index.ts", () => ({
  useTourEntryPoints: () => ({ onEndTour: vi.fn() }),
}));
vi.mock("../../onboarding/spotlights/spotlight-overlay.tsx", () => ({
  writeSpotlightFragment: vi.fn(),
}));

vi.mock("../automate-button.tsx", () => ({ AutomateButton: () => <div data-testid="automate" /> }));
vi.mock("../columns-dropdown.tsx", () => ({
  ColumnsDropdown: () => <div data-testid="columns" />,
}));
vi.mock("../density-toggle.tsx", () => ({ DensityToggle: () => <div data-testid="density" /> }));
vi.mock("../grouping-selector.tsx", () => ({
  GroupingSelector: () => <div data-testid="grouping" />,
}));
vi.mock("../keyboard-shortcuts-button.tsx", () => ({
  KeyboardShortcutsButton: () => <div data-testid="shortcuts" />,
}));
vi.mock("../live-indicator.tsx", () => ({ LiveIndicator: () => <div data-testid="live" /> }));
vi.mock("../time-range-picker.tsx", () => ({
  TimeRangePicker: () => <div data-testid="time-range" />,
}));

beforeEach(() => {
  useExplorerStore.getState().clearAll();
});

afterEach(() => cleanup());

describe("the toolbar row", () => {
  describe("when the page renders", () => {
    /** @scenario Lens tabs take remaining horizontal space */
    it("lets the lens tabs grow and holds the right cluster at its own width", () => {
      const { container, getByTestId } = renderWithDesignSystem(<Toolbar />);

      const cluster = getByTestId("live").parentElement as HTMLElement;
      const tabs = container.querySelector('[data-scope="tabs"][data-part="root"]') as HTMLElement;
      const tabsBox = tabs.parentElement as HTMLElement;

      expect(tabsBox.parentElement).toBe(cluster.parentElement);
      expect(getComputedStyle(tabs).flexGrow).toBe("1");
      expect(getComputedStyle(tabs).minWidth).toBe("0px");
      expect(getComputedStyle(tabsBox).flexGrow).toBe("1");
      expect(getComputedStyle(cluster).flexShrink).toBe("0");
      expect(getComputedStyle(cluster).flexGrow).not.toBe("1");
      expect(tabsBox.compareDocumentPosition(cluster) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
  });
});
