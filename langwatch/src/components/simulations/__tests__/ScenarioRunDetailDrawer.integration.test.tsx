/**
 * @vitest-environment jsdom
 *
 * Integration tests for the ScenarioRunDetailDrawer composition.
 * Individual components (ScenarioRunHeader, SimulationConsole, ScenarioRunActions)
 * have their own tests — these verify the drawer assembles them correctly.
 *
 * @see specs/features/scenarios/run-view-side-by-side-layout.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import type { ScenarioMessageSnapshotEvent } from "~/server/scenarios/scenario-event.types";
import { Drawer } from "../../ui/drawer";
import { ScenarioMessageRenderer } from "../ScenarioMessageRenderer";
import { ScenarioRunHeader } from "../ScenarioRunHeader";
import { SimulationConsole } from "../simulation-console/SimulationConsole";

// MediaPart fires a tRPC existence probe on a media error event; stub it so the
// probe never resolves to a placeholder on the happy path (mirrors the
// standalone ScenarioMessageRenderer + MediaPart integration tests).
vi.mock("~/utils/api", () => ({
  api: {
    storedObjects: {
      headById: {
        useQuery: () => ({ data: undefined }),
      },
    },
  },
}));

vi.mock("../../copilot-kit/TraceMessage", () => ({
  TraceMessage: ({ traceId }: { traceId: string }) => (
    <button data-testid="trace-message" data-trace-id={traceId}>
      View Trace
    </button>
  ),
}));

const DrawerWrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <Drawer.Root open={true} placement="end">
      <Drawer.Content bg="bg">{children}</Drawer.Content>
    </Drawer.Root>
  </ChakraProvider>
);

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("ScenarioRunDetailDrawer", () => {
  afterEach(cleanup);
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  describe("ScenarioRunHeader in drawer context", () => {
    describe("given a failed run", () => {
      /** @scenario Drawer header shows run identity and status */
      it("displays the scenario name and status icon", () => {
        render(
          <ScenarioRunHeader
            name="Echo user request"
            status={ScenarioRunStatus.FAILED}
            copyableIds={[{ label: "Scenario ID", value: "sc-123" }]}
          />,
          { wrapper: DrawerWrapper },
        );

        expect(screen.getByText("Echo user request")).toBeInTheDocument();
        expect(screen.getByText("Scenario ID: sc-123")).toBeInTheDocument();
      });
    });

    describe("given a run with display title and copyable IDs", () => {
      it("displays the display title with target name", () => {
        render(
          <ScenarioRunHeader
            name="my-agent: Echo user request"
            status={ScenarioRunStatus.FAILED}
            copyableIds={[
              { label: "Scenario ID", value: "sc-123" },
              { label: "Batch Run ID", value: "br-456" },
              { label: "Run ID", value: "sr-789" },
            ]}
          />,
          { wrapper: DrawerWrapper },
        );

        expect(
          screen.getByText("my-agent: Echo user request"),
        ).toBeInTheDocument();
      });

      it("displays copyable IDs below the header", () => {
        render(
          <ScenarioRunHeader
            name="my-agent: Echo user request"
            status={ScenarioRunStatus.FAILED}
            copyableIds={[
              { label: "Scenario ID", value: "sc-123" },
              { label: "Batch Run ID", value: "br-456" },
              { label: "Run ID", value: "sr-789" },
            ]}
          />,
          { wrapper: DrawerWrapper },
        );

        expect(screen.getByText("Scenario ID: sc-123")).toBeInTheDocument();
        expect(screen.getByText("Batch Run ID: br-456")).toBeInTheDocument();
        expect(screen.getByText("Run ID: sr-789")).toBeInTheDocument();
      });
    });
  });

  describe("SimulationConsole in drawer context", () => {
    describe("given a completed run with results", () => {
      /** @scenario Criteria section shows pass/fail summary */
      it("displays the test report with criteria", () => {
        render(
          <SimulationConsole
            results={{
              verdict: Verdict.FAILURE,
              metCriteria: ["Is polite"],
              unmetCriteria: ["Must repeat verbatim"],
              reasoning: "Did not echo.",
            }}
            scenarioName="Echo user request"
            status={ScenarioRunStatus.FAILED}
            durationInMs={6300}
          />,
          { wrapper: Wrapper },
        );

        expect(
          screen.getByText("=== Scenario Test Report ==="),
        ).toBeInTheDocument();
        expect(screen.getByText(/Must repeat verbatim/)).toBeInTheDocument();
      });
    });

    describe("given a pending run", () => {
      it("displays running status without criteria", () => {
        render(
          <SimulationConsole
            results={null}
            status={ScenarioRunStatus.IN_PROGRESS}
          />,
          { wrapper: Wrapper },
        );

        expect(
          screen.getByText("=== Scenario Test Report ==="),
        ).toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  // #4138 — post-extraction `input_audio` URL shape, in the DRAWER context.
  //
  // The drawer mounts <ScenarioMessageRenderer variant="drawer" /> inside its
  // Drawer.Content (ScenarioRunDetailDrawer.tsx:386-393). This pins that a
  // voice turn carrying the post-extraction url shape renders its native
  // <audio> when composed inside the real Drawer container — the drawer-side
  // companion to the grid-variant fixture in
  // ScenarioMessageRenderer.integration.test.tsx.
  // -------------------------------------------------------------------------
  describe("when rendering a voice turn with a url-shape audio source in the drawer (#4138)", () => {
    it("renders a media-part-audio element whose src is the file url inside the drawer", () => {
      render(
        <ScenarioMessageRenderer
          variant="drawer"
          projectId="proj_test"
          messages={[
            {
              id: "msg_audio_url_drawer",
              role: "assistant",
              content: [
                {
                  type: "input_audio",
                  input_audio: {
                    url: "/api/files/test-id",
                    mimeType: "audio/mpeg",
                  },
                },
              ],
            } as unknown as ScenarioMessageSnapshotEvent["messages"][number],
          ]}
        />,
        { wrapper: DrawerWrapper },
      );

      const audio = screen.getByTestId("media-part-audio") as HTMLAudioElement;
      expect(audio).toBeInTheDocument();
      expect(audio.tagName.toLowerCase()).toBe("audio");
      expect(audio).toHaveAttribute("src", "/api/files/test-id");
      expect(audio).toHaveAttribute("controls");
      expect(screen.queryByText(/input_audio/)).toBeNull();
    });
  });
});
