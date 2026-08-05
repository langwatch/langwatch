// @vitest-environment jsdom
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

/**
 * The per-turn route into an annotation queue. Each turn is its own trace.
 * Spec: specs/traces-v2/annotation-queue-actions.feature
 */

const { mockRequestEnable, mockHasPermission, dialogProps } = vi.hoisted(
  () => ({
    mockRequestEnable: vi.fn(),
    mockHasPermission: vi.fn(),
    dialogProps: vi.fn(),
  }),
);

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), drawerOpen: () => false }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "acme" },
    hasPermission: mockHasPermission,
  }),
}));

vi.mock("~/components/me/usePersonalFeatureGate", () => ({
  usePersonalFeatureGate: () => ({
    requestEnable: mockRequestEnable,
    dialogState: null,
  }),
}));

vi.mock("~/components/me/PersonalFeatureGateDialog", () => ({
  PersonalFeatureGateDialog: () => null,
}));

vi.mock("../AnnotationPopover", () => ({
  AnnotationPopover: () => null,
}));

vi.mock("../../../annotationQueue/AddToAnnotationQueueDialog", () => ({
  AddToAnnotationQueueDialog: (props: {
    open: boolean;
    traceIds: string[];
  }) => {
    dialogProps(props);
    return props.open ? <div data-testid="queue-dialog" /> : null;
  },
}));

vi.mock("~/utils/api", () => ({
  api: {
    annotation: {
      getByTraceId: { useQuery: () => ({ data: [] }) },
    },
  },
}));

import { TurnActionRow } from "../TurnAnnotations";

const renderRow = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <TurnActionRow traceId="turn-trace-17" output="an output" />
    </ChakraProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockHasPermission.mockReturnValue(true);
  mockRequestEnable.mockResolvedValue(true);
});
afterEach(cleanup);

describe("TurnActionRow annotation queue action", () => {
  describe("given the user can manage annotations", () => {
    it("offers Queue beside the other turn actions", () => {
      renderRow();

      expect(screen.getByText("Queue")).toBeInTheDocument();
      expect(screen.getByText("Dataset")).toBeInTheDocument();
    });

    describe("when the gate allows it", () => {
      it("opens the shared dialog with that turn's trace", async () => {
        const user = userEvent.setup();
        renderRow();

        await user.click(screen.getByText("Queue"));

        await waitFor(() =>
          expect(screen.getByTestId("queue-dialog")).toBeInTheDocument(),
        );
        expect(dialogProps).toHaveBeenLastCalledWith(
          expect.objectContaining({ open: true, traceIds: ["turn-trace-17"] }),
        );
      });
    });

    describe("when the gate is declined", () => {
      it("leaves the dialog closed", async () => {
        mockRequestEnable.mockResolvedValue(false);
        const user = userEvent.setup();
        renderRow();

        await user.click(screen.getByText("Queue"));

        await waitFor(() => expect(mockRequestEnable).toHaveBeenCalledTimes(1));
        expect(screen.queryByTestId("queue-dialog")).not.toBeInTheDocument();
      });
    });
  });

  describe("given the user cannot manage annotations", () => {
    it("renders no turn actions at all", () => {
      mockHasPermission.mockReturnValue(false);
      renderRow();

      expect(screen.queryByText("Queue")).not.toBeInTheDocument();
      expect(screen.queryByText("Annotate")).not.toBeInTheDocument();
    });
  });
});
