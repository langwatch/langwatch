/**
 * @vitest-environment jsdom
 *
 * The Sessions page while the personal workspace is still being created: a setting-up
 * state, never an error and never "No sessions yet", then the table once it answers.
 */
import { cleanup, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PersonalContext } from "../../../../behavior/use-personal-context.ts";
import {
  fakePersonalWorkspaceHost,
  renderWithPersonalWorkspaceHost,
} from "../../../../testing.tsx";
import { PersonalSessionsScreen } from "../personal-sessions.screen.tsx";

const { state } = vi.hoisted(() => ({ state: { ctx: {} as Partial<PersonalContext> } }));

vi.mock("../../../../behavior/use-personal-context.ts", () => ({
  usePersonalContext: () => state.ctx,
}));
vi.mock("../../../../behavior/lent-coding-agent-tables.tsx", () => ({
  CodingAgentSessionsTable: ({ projectId }: { projectId: string }) => (
    <div data-testid="sessions-table" data-project-id={projectId} />
  ),
}));
vi.mock("../../personal-workspace-layout.tsx", () => ({
  PersonalWorkspaceLayout: ({ children }: { children: ReactNode }) => children,
}));

describe("PersonalSessionsScreen", () => {
  afterEach(() => cleanup());

  describe("when the personal workspace is still being created", () => {
    it("shows the setting-up state and no error or empty claim", () => {
      state.ctx = {
        ready: true,
        isPersonalProjectResolved: false,
        isWorkspacePending: true,
        personalProjectId: null,
        personalProjectSlug: null,
      };
      renderWithPersonalWorkspaceHost(<PersonalSessionsScreen />, {
        host: fakePersonalWorkspaceHost(),
      });

      expect(screen.getByText(/Setting up your workspace/)).toBeTruthy();
      expect(screen.queryByText("No sessions yet")).toBeNull();
      expect(screen.queryByText(/personal_workspace_pending|error|failed/i)).toBeNull();
    });
  });

  describe("when the workspace later answers", () => {
    it("renders the sessions table", () => {
      state.ctx = {
        ready: true,
        isPersonalProjectResolved: true,
        isWorkspacePending: false,
        personalProjectId: "proj_me",
        personalProjectSlug: "me",
      };
      renderWithPersonalWorkspaceHost(<PersonalSessionsScreen />, {
        host: fakePersonalWorkspaceHost(),
      });

      expect(screen.getByTestId("sessions-table").dataset.projectId).toBe("proj_me");
      expect(screen.queryByText(/Setting up your workspace/)).toBeNull();
    });
  });
});
