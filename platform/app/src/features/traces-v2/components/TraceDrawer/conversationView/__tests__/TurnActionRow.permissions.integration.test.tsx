/**
 * @vitest-environment jsdom
 *
 * Which of the turn's actions each reader is offered. The three do different
 * work and ask for what that work needs: annotating and suggesting need the
 * annotation permission, capturing the turn into a dataset is dataset work, and
 * translating what is on screen is a reading activity.
 * See specs/traces-v2/annotations.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  canManageAnnotations: true,
  openDrawer: vi.fn(),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1" },
    hasPermission: (permission: string) =>
      permission === "annotations:manage" ? mocks.canManageAnnotations : true,
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: mocks.openDrawer }),
}));

vi.mock("~/components/me/usePersonalFeatureGate", () => ({
  usePersonalFeatureGate: () => ({
    requestEnable: async () => true,
    dialogState: null,
  }),
}));

vi.mock("~/components/me/PersonalFeatureGateDialog", () => ({
  PersonalFeatureGateDialog: () => null,
}));

vi.mock("~/utils/api", () => ({
  api: { annotation: { getByTraceId: { useQuery: () => ({ data: [] }) } } },
}));

import { useAnnotationDraftStore } from "../../../../stores/annotationDraftStore";
import { TurnActionRow } from "../TurnAnnotations";

const TRACE_ID = "trace-1";

function renderRow() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TurnActionRow
        traceId={TRACE_ID}
        output="the original answer"
        shouldUseRailComposer
        translation={{
          isActive: false,
          isLoading: false,
          onToggle: vi.fn(),
        }}
      />
    </ChakraProvider>,
  );
}

const button = (name: string) => screen.queryByRole("button", { name });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canManageAnnotations = true;
  useAnnotationDraftStore.setState({ draft: null });
  cleanup();
});

describe("given a reviewer who may write annotations", () => {
  it("offers every action on the turn", () => {
    renderRow();

    expect(button("Annotate")).toBeInTheDocument();
    expect(button("Suggest")).toBeInTheDocument();
    expect(button("Dataset")).toBeInTheDocument();
    expect(button("Translate")).toBeInTheDocument();
  });

  /** @scenario "Annotate opens the composer in the rail beside the turn" */
  it("opens the composer in the rail, scoped to the turn", async () => {
    renderRow();

    fireEvent.click(button("Annotate")!);

    await vi.waitFor(() =>
      expect(useAnnotationDraftStore.getState().draft).toMatchObject({
        traceId: TRACE_ID,
        mode: "annotate",
      }),
    );
    expect(screen.queryByPlaceholderText("Optional")).not.toBeInTheDocument();
  });
});

describe("given a reader who may not write annotations", () => {
  beforeEach(() => {
    mocks.canManageAnnotations = false;
  });

  /** @scenario "Each action asks for the permission its own work needs" */
  it("offers no way to annotate or suggest", () => {
    renderRow();

    expect(button("Annotate")).not.toBeInTheDocument();
    expect(button("Suggest")).not.toBeInTheDocument();
  });

  /** @scenario "Each action asks for the permission its own work needs" */
  it("still offers to capture the turn into a dataset", () => {
    renderRow();

    fireEvent.click(button("Dataset")!);

    expect(button("Dataset")).toBeInTheDocument();
  });

  /** @scenario "Each action asks for the permission its own work needs" */
  it("still offers to translate the turn", () => {
    renderRow();

    expect(button("Translate")).toBeInTheDocument();
  });
});
