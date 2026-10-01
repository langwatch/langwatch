/**
 * @vitest-environment jsdom
 * @see specs/langy/langy-guided-onboarding.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@langwatch/browser-host/use-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "p_demo", slug: "demo" } }),
}));
vi.mock("../../../../../behavior/langy-api.ts", () => ({
  api: { useUtils: () => ({}) },
}));

const tour = { running: false, replay: vi.fn() };
vi.mock("../../../behavior/use-guided-tour.ts", () => ({
  useGuidedTour: () => ({ useRunning: () => tour.running, useReplay: () => tour.replay }),
}));

import { GuidedTourCard } from "../derived-cards/guided-tour-card.tsx";
import { MessageContent } from "../message-content.tsx";

const KICKOFF = {
  type: "guided-onboarding-kickoff",
  path: "llmops",
  paths: ["llmops", "governance"],
  provider: "OpenAI",
  providerModel: "gpt-5",
  orgName: "ACME",
  tourStatus: "completed",
} as const;

function kickoffMessage(over: Record<string, unknown> = {}): UIMessage {
  return {
    id: "m-kickoff",
    role: "user",
    parts: [
      { ...KICKOFF, ...over } as never,
      { type: "text", text: "Guided onboarding kickoff.\nPath: llmops" },
    ],
  };
}

const bash = (command: string, output = "ok") =>
  ({
    type: "tool-bash",
    toolCallId: `call-${command.length}`,
    state: "output-available",
    input: { command },
    output,
  }) as never;

function assistant(parts: unknown[]): UIMessage {
  return { id: "m-assistant", role: "assistant", parts: parts as UIMessage["parts"] };
}

function renderMessage(
  message: UIMessage,
  extra: {
    guidedPullRequest?: { url?: string; title?: string; branch?: string };
    hideGithubProgress?: boolean;
  } = {},
) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MessageContent
        message={message}
        organizationId="org_1"
        appliedOutcomes={{}}
        discardedProposals={new Set()}
        applyingProposals={new Set()}
        onApply={async () => {}}
        onDiscard={() => {}}
        {...extra}
      />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  tour.running = false;
  tour.replay.mockClear();
});
afterEach(cleanup);

describe("a kickoff message", () => {
  /** @scenario A kickoff message renders as the tour card */
  /** @scenario "A reloaded conversation renders the same card" */
  it("renders as the tour card and never as a bubble", () => {
    renderMessage(kickoffMessage());

    expect(screen.getByTestId("guided-tour-card")).toBeInTheDocument();
    expect(screen.queryByTestId("langy-user-message")).toBeNull();
    expect(screen.queryByText(/Guided onboarding kickoff/)).toBeNull();
  });

  /** @scenario The card settles once the tour is over */
  it("reads Guided tour with a chevron once the tour is over", () => {
    renderMessage(kickoffMessage());
    expect(screen.getByText("Guided tour")).toBeInTheDocument();
    expect(screen.getByRole("button", { expanded: false })).toBeEnabled();
  });

  /** @scenario The card shows the tour in progress */
  it("reads Doing guided tour and cannot be expanded while the tour runs", () => {
    tour.running = true;
    renderMessage(kickoffMessage());
    expect(screen.getByText("Doing guided tour")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeDisabled();
  });

  /** @scenario Expanding the card shows what the takeover collected */
  it("shows what the takeover collected when expanded", () => {
    renderMessage(kickoffMessage());
    fireEvent.click(screen.getByText("Guided tour"));

    expect(screen.getByText("Setting up for").nextSibling).toHaveTextContent("ACME");
    expect(screen.getByText("You picked").nextSibling).toHaveTextContent(
      "Evals & LLM Ops, Governance",
    );
    expect(screen.getByText("Provider").nextSibling).toHaveTextContent("OpenAI · gpt-5");
    expect(screen.getByRole("button", { name: /Show me around again/ })).toBeInTheDocument();
  });

  /** @scenario A kickoff without a provider shows no provider row */
  it("shows no provider row when none was recorded", () => {
    renderMessage(kickoffMessage({ provider: undefined, providerModel: undefined }));
    fireEvent.click(screen.getByText("Guided tour"));
    expect(screen.queryByText("Provider")).toBeNull();
  });

  /** @scenario A kickoff without an organization name sets up for you */
  it("sets up for you without an organization name", () => {
    renderMessage(kickoffMessage({ orgName: undefined }));
    fireEvent.click(screen.getByText("Guided tour"));
    expect(screen.getByText("Setting up for").nextSibling).toHaveTextContent("you");
  });

  /** @scenario Clicking the row never replays the tour */
  it("expands on a row click and never replays", () => {
    renderMessage(kickoffMessage());
    fireEvent.click(screen.getByText("Guided tour"));

    expect(screen.getByRole("button", { name: /Guided tour/, expanded: true })).toBeInTheDocument();
    expect(tour.replay).not.toHaveBeenCalled();
  });

  /** @scenario The button replays the tour and records the replay */
  it("replays the tour from the button, naming the path and the organization", () => {
    renderMessage(kickoffMessage());
    fireEvent.click(screen.getByText("Guided tour"));
    fireEvent.click(screen.getByRole("button", { name: /Show me around again/ }));

    expect(tour.replay).toHaveBeenCalledWith({ path: "llmops", organizationId: "org_1" });
  });
});

describe("the tour card before the kickoff message exists", () => {
  /** @scenario The panel shows the tour in progress before the kickoff exists */
  it("shows the tour in progress with no kickoff yet", () => {
    tour.running = true;
    render(
      <ChakraProvider value={defaultSystem}>
        <GuidedTourCard kickoff={null} organizationId="org_1" />
      </ChakraProvider>,
    );
    expect(screen.getByText("Doing guided tour")).toBeInTheDocument();
  });
});

describe("a guided conversation's closing reply", () => {
  const closing = () =>
    assistant([
      { type: "text", text: "You are set up." },
      bash("langwatch onboarding complete-path llmops"),
    ]);
  const pullRequest = {
    url: "https://github.com/acme/app/pull/12",
    title: "Add LangWatch tracing",
    branch: "langwatch/tracing",
  };

  /** @scenario The pull request card closes the path */
  it("draws one pull request card after the closing line", () => {
    renderMessage(closing(), { guidedPullRequest: pullRequest });

    expect(screen.getByLabelText("Guided path pull request")).toBeInTheDocument();
    expect(screen.getByText("Add LangWatch tracing")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open pull request/ })).toHaveAttribute(
      "href",
      pullRequest.url,
    );
  });

  it("draws no such card for a reply that did not close the path", () => {
    renderMessage(assistant([{ type: "text", text: "Working on it." }]), {
      guidedPullRequest: pullRequest,
    });
    expect(screen.queryByLabelText("Guided path pull request")).toBeNull();
  });

  it("names the branch that holds the commit when there is no pull request", () => {
    renderMessage(closing(), { guidedPullRequest: { branch: "langwatch/tracing" } });
    expect(screen.getByLabelText("Guided path branch")).toBeInTheDocument();
    expect(screen.getByText("langwatch/tracing")).toBeInTheDocument();
  });
});

describe("a guided conversation's progress", () => {
  const committed = () =>
    assistant([
      { type: "text", text: "All done." },
      bash("git checkout -b langwatch/tracing && git commit -m tracing"),
    ]);

  it("draws the pull request progress receipt in an ordinary conversation", () => {
    renderMessage(committed());
    expect(screen.getByText("Committed")).toBeInTheDocument();
  });

  /** @scenario A guided conversation shows no progress card */
  it("draws no pull request progress receipt when hidden", () => {
    renderMessage(committed(), { hideGithubProgress: true });
    expect(screen.queryByText("Committed")).toBeNull();
  });
});
