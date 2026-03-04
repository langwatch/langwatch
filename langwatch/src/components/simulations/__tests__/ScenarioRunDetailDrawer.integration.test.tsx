/**
 * @vitest-environment jsdom
 *
 * Integration tests for ScenarioRunDetailDrawer presentational components.
 *
 * @see specs/features/scenarios/run-view-side-by-side-layout.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Verdict } from "~/server/scenarios/scenario-event.enums";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { Drawer } from "../../ui/drawer";
import {
  CriteriaSummary,
  CriterionRow,
  DrawerHeader,
  formatDuration,
} from "../ScenarioRunDetailContent";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const DrawerWrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <Drawer.Root open={true} placement="end">
      <Drawer.Content>{children}</Drawer.Content>
    </Drawer.Root>
  </ChakraProvider>
);

describe("<DrawerHeader/>", () => {
  afterEach(cleanup);

  describe("given a completed failed run", () => {
    beforeEach(() => {
      render(
        <DrawerHeader
          name="Echo user request"
          status={ScenarioRunStatus.FAILED}
          durationInMs={6300}
        />,
        { wrapper: DrawerWrapper },
      );
    });

    describe("when rendering the header", () => {
      it("displays the scenario name", () => {
        expect(screen.getByText("Echo user request")).toBeInTheDocument();
      });

      it("displays the failure status badge", () => {
        expect(screen.getByText("failed")).toBeInTheDocument();
      });

      it("displays the duration", () => {
        expect(screen.getByText("6.3s")).toBeInTheDocument();
      });
    });
  });

  describe("given a successful run", () => {
    describe("when rendering the header", () => {
      it("displays the completed status badge", () => {
        render(
          <DrawerHeader
            name="Test scenario"
            status={ScenarioRunStatus.SUCCESS}
            durationInMs={1200}
          />,
          { wrapper: DrawerWrapper },
        );

        expect(screen.getByText("completed")).toBeInTheDocument();
      });
    });
  });

  describe("given no name", () => {
    describe("when rendering the header", () => {
      it("displays a fallback name", () => {
        render(
          <DrawerHeader
            name={null}
            status={ScenarioRunStatus.IN_PROGRESS}
            durationInMs={0}
          />,
          { wrapper: DrawerWrapper },
        );

        expect(screen.getByText("Scenario Run")).toBeInTheDocument();
      });
    });
  });
});

describe("formatDuration()", () => {
  describe("when duration is under 60 seconds", () => {
    it("formats as seconds with one decimal", () => {
      expect(formatDuration(6300)).toBe("6.3s");
    });
  });

  describe("when duration is over 60 seconds", () => {
    it("formats as minutes and seconds", () => {
      expect(formatDuration(125000)).toBe("2m 5s");
    });
  });
});

describe("<CriteriaSummary/>", () => {
  afterEach(cleanup);

  describe("given a run with 4 criteria where 0 passed", () => {
    const results = {
      verdict: Verdict.FAILURE,
      metCriteria: [],
      unmetCriteria: [
        "Response is relevant",
        "Response is concise",
        "Response uses correct format",
        "Response is helpful",
      ],
      reasoning: "The response failed all criteria.",
    };

    beforeEach(() => {
      render(<CriteriaSummary results={results} />, { wrapper: Wrapper });
    });

    describe("when rendering the criteria section", () => {
      it("displays the pass/fail summary", () => {
        expect(screen.getByText("Criteria: 0/4 passed")).toBeInTheDocument();
      });

      it("displays each criterion name", () => {
        expect(screen.getByText("Response is relevant")).toBeInTheDocument();
        expect(screen.getByText("Response is concise")).toBeInTheDocument();
        expect(
          screen.getByText("Response uses correct format"),
        ).toBeInTheDocument();
        expect(screen.getByText("Response is helpful")).toBeInTheDocument();
      });

      it("displays FAIL indicator for each criterion", () => {
        const failIndicators = screen.getAllByText("FAIL");
        expect(failIndicators).toHaveLength(4);
      });
    });
  });

  describe("given a run with 3 met and 1 unmet criteria", () => {
    const results = {
      verdict: Verdict.FAILURE,
      metCriteria: ["Is polite", "Is relevant", "Is concise"],
      unmetCriteria: ["Uses correct format"],
      reasoning: "Format was wrong.",
    };

    beforeEach(() => {
      render(<CriteriaSummary results={results} />, { wrapper: Wrapper });
    });

    describe("when rendering the criteria section", () => {
      it("displays the correct pass/fail summary", () => {
        expect(screen.getByText("Criteria: 3/4 passed")).toBeInTheDocument();
      });

      it("displays PASS indicators for met criteria", () => {
        const passIndicators = screen.getAllByText("PASS");
        expect(passIndicators).toHaveLength(3);
      });
    });
  });

  describe("given no results", () => {
    describe("when rendering the criteria section", () => {
      it("renders nothing", () => {
        const { container } = render(<CriteriaSummary results={null} />, {
          wrapper: Wrapper,
        });

        expect(container.innerHTML).toBe("");
      });
    });
  });
});

describe("<CriterionRow/>", () => {
  afterEach(cleanup);

  describe("given a failed criterion with reasoning", () => {
    describe("when clicking the criterion row", () => {
      it("expands to show reasoning text", async () => {
        const user = userEvent.setup();

        render(
          <CriterionRow
            name="Response is relevant"
            passed={false}
            reasoning="The response did not address the user's question."
          />,
          { wrapper: Wrapper },
        );

        const expandButton = screen.getByRole("button");
        await user.click(expandButton);

        expect(
          screen.getByText(
            "The response did not address the user's question.",
          ),
        ).toBeVisible();
      });
    });
  });

  describe("given a passed criterion", () => {
    describe("when rendered", () => {
      it("does not have an expand button", () => {
        render(
          <CriterionRow name="Is polite" passed={true} />,
          { wrapper: Wrapper },
        );

        expect(screen.queryByRole("button")).not.toBeInTheDocument();
      });

      it("displays PASS indicator", () => {
        render(
          <CriterionRow name="Is polite" passed={true} />,
          { wrapper: Wrapper },
        );

        expect(screen.getByText("PASS")).toBeInTheDocument();
      });
    });
  });
});
