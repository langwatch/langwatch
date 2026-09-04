/**
 * @vitest-environment jsdom
 *
 * The steps card reads a turn, and a turn ends. It used to say "working on it"
 * for the life of the transcript, so a pull request opened eight minutes ago
 * still read as work in progress after a reload.
 *
 * @see specs/langy/langy-github-prs.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LangyGitHubProgressCard } from "../components/github/LangyGitHubProgressCard";

function renderCard({
  events,
  live,
}: {
  events: Parameters<typeof LangyGitHubProgressCard>[0]["events"];
  live?: boolean;
}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyGitHubProgressCard events={events} live={live} />
    </ChakraProvider>,
  );
}

describe("LangyGitHubProgressCard", () => {
  describe("given a settled turn that opened the pull request", () => {
    /** @scenario "The steps card stops calling the turn work in progress once it ends" */
    it("says the pull request was opened", () => {
      renderCard({
        events: [
          { stage: "branched", detail: "langy/add-tracing" },
          { stage: "committed", detail: "feat: add LangWatch tracing" },
          { stage: "pushed" },
          { stage: "opened" },
        ],
      });

      expect(screen.getByText("Opened")).toBeTruthy();
      expect(screen.queryByText(/Working on it/i)).toBeNull();
    });
  });

  describe("given a settled turn that stopped after the push", () => {
    /** @scenario "A finished turn that never opened a pull request says so plainly" */
    it("names the furthest step instead of working on it", () => {
      renderCard({
        events: [
          { stage: "committed", detail: "feat: parameterize refund accounts" },
          { stage: "pushed" },
        ],
      });

      expect(screen.getByText("Pushed")).toBeTruthy();
      expect(screen.queryByText(/Working on it/i)).toBeNull();
    });
  });

  describe("given a turn that is still running", () => {
    it("keeps saying it is working on it", () => {
      renderCard({
        live: true,
        events: [{ stage: "branched", detail: "langy/add-tracing" }],
      });

      expect(
        screen.getByText(/Working on it · langy\/add-tracing/i),
      ).toBeTruthy();
    });
  });
});
