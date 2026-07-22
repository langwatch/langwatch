/** @vitest-environment jsdom */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

import { MessageContent } from "../components/MessageContent";
import { LANGY_OPEN_PR_TOOL } from "~/shared/langy/githubPrCard";

// MessageContent reads the project for card deep-links; rendering it bare
// (no tRPC provider) needs the same pinned project the sibling suites use.
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "p_demo", slug: "demo" },
  }),
}));

/**
 * GitHub interactions render THE GitHub card set — the progress card for the
 * clone → branch → commit → push → PR flow, and the PR receipt card for an
 * opened PR — never prose scraping and never a generic JSON dump. This is the
 * one insertion point (MessageContent), pinned so a refactor cannot quietly
 * route GitHub work back to generic rendering.
 * Spec: specs/langy/langy-github-prs.feature
 */

function assistantMessage(parts: unknown[]): UIMessage {
  return { id: "assistant-1", role: "assistant", parts: parts as never };
}

function renderMessage(message: UIMessage) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MessageContent
        message={message}
        appliedOutcomes={{}}
        discardedProposals={new Set()}
        applyingProposals={new Set()}
        onApply={async () => undefined}
        onDiscard={() => undefined}
      />
    </ChakraProvider>,
  );
}

const OPENED_PR = {
  owner: "acme",
  repo: "checkout",
  number: 412,
  url: "https://github.com/acme/checkout/pull/412",
  state: "open",
  title: "Fix the retriever dropping the last chunk on long documents",
  headRef: "langy/fix-retriever",
  baseRef: "main",
  author: "octocat",
  additions: 38,
  deletions: 12,
  changedFiles: 3,
};

describe("the GitHub card set", () => {
  describe("when the turn is mid-flow on the repository", () => {
    it("renders the progress card off the git commands themselves", () => {
      const { container } = renderMessage(
        assistantMessage([
          {
            type: "tool-bash",
            toolCallId: "c1",
            state: "output-available",
            input: { command: "git clone https://x-access-token@github.com/acme/checkout" },
          },
          {
            type: "tool-bash",
            toolCallId: "c2",
            state: "input-available",
            input: { command: "git push -u origin langy/fix-retriever" },
          },
        ]),
      );

      expect(container.textContent).toContain("Working on it");
    });
  });

  describe("when a PR was opened", () => {
    it("renders the PR receipt card from the open_pr tool output", () => {
      const { container } = renderMessage(
        assistantMessage([
          {
            type: `tool-${LANGY_OPEN_PR_TOOL}`,
            toolCallId: "c1",
            state: "output-available",
            output: JSON.stringify(OPENED_PR),
          },
        ]),
      );

      expect(container.textContent).toContain(
        "Fix the retriever dropping the last chunk on long documents",
      );
      expect(container.textContent).toContain("#412");
    });
  });

  describe("when gh pr create failed", () => {
    it("renders no PR card — a PR that did not open never renders as one that did", () => {
      const { container } = renderMessage(
        assistantMessage([
          {
            type: `tool-${LANGY_OPEN_PR_TOOL}`,
            toolCallId: "c1",
            state: "output-error",
            output: JSON.stringify(OPENED_PR),
            errorText: "gh pr create failed",
          },
        ]),
      );

      expect(container.textContent).not.toContain("#412");
    });
  });
});
