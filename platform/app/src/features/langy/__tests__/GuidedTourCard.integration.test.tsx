/**
 * @vitest-environment jsdom
 *
 * The guided onboarding kickoff, rendered: a user message carrying the
 * kickoff part draws the tour card and never a bubble, whether it just
 * streamed or came back from the durable history; the card spins while the
 * tour runs and settles to an expandable summary whose only replay is the
 * button.
 *
 * Boundary mocks: router, project hook, the tRPC client (the replay record).
 *
 * @see specs/langy/langy-guided-onboarding.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recordTour = vi.fn();

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "p_demo", slug: "demo" },
    organization: { id: "org_1" },
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({}),
    onboarding: {
      recordTour: {
        useMutation: () => ({ mutate: recordTour, isPending: false }),
      },
    },
    dashboards: {
      getAll: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    graphs: { create: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
  },
}));

import {
  buildGuidedKickoffParts,
  type GuidedKickoffInput,
} from "~/features/guided-onboarding/kickoff";
import { useGuidedTourStore } from "~/features/guided-onboarding/tour/guidedTourStore";
import { MessageContent } from "../components/MessageContent";

const KICKOFF: GuidedKickoffInput = {
  path: "llmops",
  paths: ["llmops", "governance"],
  provider: "OpenAI",
  providerModel: "gpt-5",
  orgName: "ACME",
  firstName: "Ada",
  tourStatus: "completed",
};

function kickoffMessage({
  input = KICKOFF,
  recorded = false,
}: {
  input?: GuidedKickoffInput;
  recorded?: boolean;
} = {}): UIMessage {
  return {
    id: "m-kickoff",
    role: "user",
    parts: buildGuidedKickoffParts({ input }) as unknown as UIMessage["parts"],
    metadata: recorded ? { recorded: true } : {},
  };
}

function renderMessage(message: UIMessage) {
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
      />
    </ChakraProvider>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  recordTour.mockClear();
  useGuidedTourStore.setState({ running: false });
});

describe("given a conversation whose first user message carries the kickoff part", () => {
  /** @scenario "A kickoff message renders as the tour card" */
  it("renders the tour card and no bubble with the brief", () => {
    renderMessage(kickoffMessage());

    expect(screen.getByTestId("guided-tour-card")).toBeDefined();
    expect(screen.queryByText(/Guided onboarding kickoff/)).toBeNull();
    expect(screen.queryByText(/Path to set up now/)).toBeNull();
  });

  /** @scenario "A reloaded conversation renders the same card" */
  it("renders the same card for the recorded message loaded from history", () => {
    renderMessage(kickoffMessage({ recorded: true }));

    expect(screen.getByTestId("guided-tour-card")).toBeDefined();
    expect(screen.queryByText(/Guided onboarding kickoff/)).toBeNull();
  });

  it("still renders an ordinary user message as a bubble", () => {
    renderMessage({
      id: "m-plain",
      role: "user",
      parts: [{ type: "text", text: "hello there" }],
    });
    expect(screen.getByText("hello there")).toBeDefined();
    expect(screen.queryByTestId("guided-tour-card")).toBeNull();
  });
});

describe("given the guided tour is running", () => {
  beforeEach(() => {
    useGuidedTourStore.setState({ running: true });
  });

  /** @scenario "The card shows the tour in progress" */
  it("reads Doing guided tour with a spinner and cannot be expanded", () => {
    renderMessage(kickoffMessage());

    expect(screen.getByText("Doing guided tour")).toBeDefined();
    const row = screen.getByText("Doing guided tour").closest("button")!;
    expect(row.disabled).toBe(true);
    expect(row.querySelector(".chakra-spinner")).not.toBeNull();
    fireEvent.click(row);
    expect(screen.queryByText("Setting up for")).toBeNull();
  });
});

describe("given the guided tour is over", () => {
  /** @scenario "The card settles once the tour is over" */
  it("reads Guided tour with a chevron", () => {
    renderMessage(kickoffMessage());

    const row = screen.getByText("Guided tour").closest("button")!;
    expect(row.disabled).toBe(false);
    expect(row.querySelector("svg.lucide-chevron-down")).not.toBeNull();
    expect(row.querySelector(".chakra-spinner")).toBeNull();
  });

  /** @scenario "Expanding the card shows what the takeover collected" */
  it("expands to the summary rows and the replay button", () => {
    renderMessage(kickoffMessage());
    fireEvent.click(screen.getByText("Guided tour"));

    expect(screen.getByText("Setting up for").nextSibling?.textContent).toBe(
      "ACME",
    );
    expect(screen.getByText("You picked").nextSibling?.textContent).toBe(
      "Evals & LLM Ops, Governance",
    );
    expect(screen.getByText("Provider").nextSibling?.textContent).toBe(
      "OpenAI · gpt-5",
    );
    expect(screen.getByText("Show me around again")).toBeDefined();
  });

  /** @scenario "A kickoff without a provider shows no provider row" */
  it("shows no provider row when none was recorded", () => {
    renderMessage(
      kickoffMessage({
        input: { ...KICKOFF, provider: undefined, providerModel: undefined },
      }),
    );
    fireEvent.click(screen.getByText("Guided tour"));

    expect(screen.queryByText("Provider")).toBeNull();
    expect(screen.getByText("Setting up for")).toBeDefined();
  });

  /** @scenario "A kickoff without an organization name sets up for you" */
  it("sets up for you when the organization has no name", () => {
    renderMessage(
      kickoffMessage({ input: { ...KICKOFF, orgName: undefined } }),
    );
    fireEvent.click(screen.getByText("Guided tour"));

    expect(screen.getByText("Setting up for").nextSibling?.textContent).toBe(
      "you",
    );
  });

  /** @scenario "Clicking the row never replays the tour" */
  it("only expands when the row is clicked", () => {
    renderMessage(kickoffMessage());
    fireEvent.click(screen.getByText("Guided tour"));

    expect(screen.getByText("Show me around again")).toBeDefined();
    expect(useGuidedTourStore.getState().running).toBe(false);
    expect(recordTour).not.toHaveBeenCalled();
  });

  /** @scenario "The button replays the tour and records the replay" */
  it("replays from the button and records the replay on the organization", () => {
    renderMessage(kickoffMessage());
    fireEvent.click(screen.getByText("Guided tour"));
    fireEvent.click(screen.getByText("Show me around again"));

    expect(useGuidedTourStore.getState().running).toBe(true);
    expect(recordTour).toHaveBeenCalledWith({
      organizationId: "org_1",
      status: "replayed",
    });
    // Running again, the card is back to the spinner.
    expect(screen.getByText("Doing guided tour")).toBeDefined();
  });
});
