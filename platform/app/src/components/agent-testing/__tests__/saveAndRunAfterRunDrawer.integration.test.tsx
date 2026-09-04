/**
 * @vitest-environment jsdom
 *
 * Save & Run after a run drawer has been opened and closed.
 *
 * The scenario editor calls back into the page through the flow callbacks, and
 * closing a drawer clears the callbacks of the flows that ran through it. The
 * page is still mounted and never hears about that close, so its registration
 * has to survive it, or the second Save & Run only saves.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  clearFlowCallbacks,
  type DrawerCallbacks,
  getFlowCallbacks,
} from "~/hooks/useDrawer";
import { AgentTestingCaseEditor } from "../cases/AgentTestingCaseEditor";
import { CASE_EDITOR_DRAWER } from "../cases/drawerKeys";
import type { RunDialogProps } from "../run/run-dialog-types";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: { project: "test-project" },
    pathname: "/test",
    asPath: "/test-project/agent-testing",
    push: vi.fn(),
    replace: vi.fn(),
    isReady: true,
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
  }),
}));

vi.mock("~/hooks/useScenarioTarget", () => ({
  readScenarioTarget: () => null,
}));

// The dialog itself is covered by its own tests; here it only has to say
// whether it was asked to open.
vi.mock("../run/RunDialog", () => ({
  RunDialog: ({ subject, onClose }: RunDialogProps) =>
    subject ? (
      <div data-testid="run-dialog-open">
        {subject.kind === "case" ? subject.name : ""}
        <button type="button" onClick={onClose}>
          close
        </button>
      </div>
    ) : null,
}));

/** The saved row, of which only the id and the name are read here. */
type SavedScenario = Parameters<
  NonNullable<DrawerCallbacks<typeof CASE_EDITOR_DRAWER>["onSaved"]>
>[0];
const SAVED = { id: "case_1", name: "Double charge" } as SavedScenario;

/** What the scenario editor drawer does when Save & Run saved. */
function saveAndRun() {
  const callbacks = getFlowCallbacks(CASE_EDITOR_DRAWER);
  act(() => {
    callbacks?.onSaved?.(SAVED, { shouldRunAfterSave: true });
  });
  return callbacks?.onSaved;
}

describe("Save & Run on the scenarios page", () => {
  beforeEach(() => {
    clearFlowCallbacks();
  });

  afterEach(cleanup);

  describe("given a run drawer was opened and closed after the first run", () => {
    /** @scenario "Save & Run opens the run dialog again after a run drawer was closed" */
    it("opens the run dialog again on the second Save & Run", async () => {
      render(<AgentTestingCaseEditor />);

      expect(saveAndRun()).toBeDefined();
      expect(screen.getByTestId("run-dialog-open")).toHaveTextContent(
        "Double charge",
      );
      act(() => screen.getByText("close").click());

      // Closing the run drawer clears the callbacks of the flows that went
      // through it.
      act(() => clearFlowCallbacks());

      expect(saveAndRun()).toBeDefined();
      expect(screen.getByTestId("run-dialog-open")).toHaveTextContent(
        "Double charge",
      );
    });
  });
});
