/**
 * @vitest-environment jsdom
 *
 * The permission card (ADR-129, specs/langy/langy-local-permissions.feature).
 * The command line decides what needs asking; this card is how the answer gets
 * back, so what it has to prove is that it names the machine, the folder and
 * the exact command, that the three answers reach the right mutation, and that
 * a settled card says what happened instead of offering the buttons again.
 *
 * Boundary mocks: the two tRPC mutations the card calls.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const answerPermission = vi.fn();
const setLocalPolicy = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    langy: {
      answerLocalPermission: {
        useMutation: () => ({
          mutate: (input: unknown, options?: { onSuccess?: () => void }) => {
            answerPermission(input);
            options?.onSuccess?.();
          },
          isPending: false,
        }),
      },
      setLocalPolicy: {
        useMutation: () => ({ mutate: setLocalPolicy, isPending: false }),
      },
    },
  },
}));

import {
  LangyLocalPermissionCard,
  SKIP_NOT_ALLOWED_HINT,
} from "../components/LangyLocalPermissionCard";
import type { LangyPermissionCardData } from "../logic/langyLocalWaits";
import { useLangyLocalControlStore } from "../stores/langyLocalControlStore";

afterEach(cleanup);
beforeEach(() => {
  answerPermission.mockClear();
  setLocalPolicy.mockClear();
});

const PENDING: LangyPermissionCardData = {
  waitId: "wait-1",
  status: "pending",
  decision: null,
  source: null,
  command: "pnpm typecheck",
  pattern: "pnpm *",
  patterns: ["pnpm *"],
  reason: "Runs the project's own type check before I commit",
  timeoutSeconds: null,
  skipOffered: true,
  workspaceName: "acme-app",
  hostname: "rogerio-mbp",
};

function renderCard(
  over: Partial<Parameters<typeof LangyLocalPermissionCard>[0]> = {},
) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyLocalPermissionCard
        projectId="p_1"
        conversationId="c_1"
        card={PENDING}
        skipAllowed
        skipPermissions={false}
        {...over}
      />
    </ChakraProvider>,
  );
}

describe("given a command the command line will not run on its own", () => {
  /** @scenario "A command outside the read-only set renders a permission card" */
  it("names the machine, the folder and the exact command, with the three answers", () => {
    renderCard();

    expect(
      screen.getByText("Langy wants to run on rogerio-mbp in acme-app"),
    ).toBeDefined();
    expect(screen.getByText("pnpm typecheck")).toBeDefined();
    expect(
      screen.getByText("Runs the project's own type check before I commit"),
    ).toBeDefined();
    expect(screen.getByText("Allow once")).toBeDefined();
    expect(screen.getByText('Allow "pnpm *" this session')).toBeDefined();
    expect(screen.getByText("Deny")).toBeDefined();
  });

  /** @scenario "Allowing once runs the command and returns its output" */
  it("sends the answer back to the wait the tool is holding", () => {
    renderCard();
    fireEvent.click(screen.getByText("Allow once"));

    expect(answerPermission).toHaveBeenCalledWith({
      projectId: "p_1",
      conversationId: "c_1",
      waitId: "wait-1",
      decision: "allow_once",
    });
  });

  it("sends the pattern grant and the denial the same way", () => {
    renderCard();
    fireEvent.click(screen.getByText('Allow "pnpm *" this session'));
    expect(answerPermission.mock.calls[0]?.[0]).toMatchObject({
      decision: "allow_pattern",
    });

    fireEvent.click(screen.getByText("Deny"));
    expect(answerPermission.mock.calls[1]?.[0]).toMatchObject({
      decision: "deny",
    });
  });
});

describe("given the conversation runs on a model allowed to skip", () => {
  /** @scenario "The skip choice is offered on the permission card" */
  it("offers to skip the checks, and says the risk is accepted", () => {
    renderCard();
    const skip = screen.getByTestId("langy-skip-permissions");
    expect(skip.getAttribute("aria-label")).toBe(
      "Skip all permission checks this session (I accept the risk)",
    );
    expect((skip as HTMLInputElement).disabled).toBe(false);
  });

  /** @scenario "Skipping records my consent and stops the cards" */
  it("records the choice for this conversation", async () => {
    renderCard();
    await userEvent.click(screen.getByTestId("langy-skip-permissions-switch"));

    expect(setLocalPolicy).toHaveBeenCalledWith({
      projectId: "p_1",
      conversationId: "c_1",
      skipPermissions: true,
    });
  });
});

describe("given a model that is not allowed to skip", () => {
  /** @scenario "A model outside the allowed list cannot skip" */
  it("disables the choice and says where the allowed list lives", () => {
    renderCard({ skipAllowed: false });

    const skip = screen.getByTestId("langy-skip-permissions");
    expect((skip as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTitle(SKIP_NOT_ALLOWED_HINT)).toBeDefined();
    expect(SKIP_NOT_ALLOWED_HINT).toContain("provider settings");
  });
});

describe("given a card that already settled", () => {
  /** @scenario "The answered card is recorded, so a reload shows the same outcome" */
  it("marks the answer and takes the buttons away", () => {
    renderCard({
      card: { ...PENDING, status: "answered", decision: "allow_once" },
    });

    expect(screen.getByText("You allowed this command once")).toBeDefined();
    expect(screen.queryByText("Allow once")).toBeNull();
    expect(screen.queryByText("Deny")).toBeNull();
  });

  /** @scenario "A pattern grant names the pattern it covers on the settled card" */
  it("names the pattern a session grant covered", () => {
    renderCard({
      card: { ...PENDING, status: "answered", decision: "allow_pattern" },
    });

    expect(
      screen.getByText('You allowed "pnpm *" for the session'),
    ).toBeDefined();
  });

  /** @scenario "A card left unanswered expires and Langy ends its turn in words" */
  it("says nobody answered in time", () => {
    renderCard({ card: { ...PENDING, status: "expired" } });
    expect(
      screen.getByText("No answer in time, Langy continued without it"),
    ).toBeDefined();
    expect(screen.queryByText("Allow once")).toBeNull();
  });

  /** @scenario "Stopping the turn closes the open question" */
  it("says a stopped turn took the card with it", () => {
    renderCard({ card: { ...PENDING, status: "cancelled" } });
    expect(screen.getByText("Cancelled with the turn")).toBeDefined();
  });

  /** @scenario "The settled card says the answer came from the terminal" */
  it("names the terminal, and the pattern the grant there covers", () => {
    renderCard({
      card: {
        ...PENDING,
        status: "answered",
        decision: "allow_pattern",
        source: "terminal",
        pattern: "uv",
        patterns: ["uv"],
      },
    });

    expect(
      screen.getByText(
        'Answered in the terminal: allowed "uv" for this session',
      ),
    ).toBeDefined();
    expect(screen.queryByText("Allow once")).toBeNull();
  });

  it("names the terminal for an allow once and for a denial too", () => {
    renderCard({
      card: {
        ...PENDING,
        status: "answered",
        decision: "allow_once",
        source: "terminal",
      },
    });
    expect(
      screen.getByText("Answered in the terminal: allowed this command once"),
    ).toBeDefined();

    cleanup();
    renderCard({
      card: {
        ...PENDING,
        status: "answered",
        decision: "deny",
        source: "terminal",
      },
    });
    expect(
      screen.getByText("Answered in the terminal: denied this command"),
    ).toBeDefined();
  });

  it("keeps the developer's own voice for an answer given on the card", () => {
    renderCard({
      card: {
        ...PENDING,
        status: "answered",
        decision: "allow_pattern",
        source: "panel",
      },
    });

    expect(
      screen.getByText('You allowed "pnpm *" for the session'),
    ).toBeDefined();
  });
});

describe("given a long command chain", () => {
  const CHAIN =
    'git add app/agent.py README.md && git commit -m "feat: add tracing" && git push -u origin HEAD && gh pr create --base main --title "Add tracing"';

  /** @scenario "The card shows the whole command, wrapped" */
  it("shows every character of it, wrapped rather than clipped", () => {
    renderCard({ card: { ...PENDING, command: CHAIN } });

    const command = screen.getByText(CHAIN);
    expect(command.textContent).toBe(CHAIN);
    const block = command.closest("pre");
    expect(block).not.toBeNull();
    expect(getComputedStyle(block as Element).whiteSpace).toBe("pre-wrap");
    expect(getComputedStyle(block as Element).overflowX).not.toBe("auto");
  });

  /** @scenario "The session grant button names every pattern the click covers" */
  it("names every pattern the one session grant covers", () => {
    renderCard({
      card: {
        ...PENDING,
        command:
          "git fetch origin && git checkout -b langy/tracing origin/main",
        pattern: "git fetch",
        patterns: ["git fetch", "git checkout"],
      },
    });

    expect(
      screen.getByText('Allow "git fetch" and "git checkout" this session'),
    ).toBeDefined();
    expect(screen.queryByText('Allow "git fetch" this session')).toBeNull();
  });

  /** @scenario "A pattern grant names the pattern it covers on the settled card" */
  it("says what the session grant covered once the card settles", () => {
    renderCard({
      card: {
        ...PENDING,
        status: "answered",
        decision: "allow_pattern",
        patterns: ["git fetch", "git checkout", "git push"],
      },
    });

    expect(
      screen.getByText(
        'You allowed "git fetch", "git checkout" and "git push" for the session',
      ),
    ).toBeDefined();
    expect(screen.queryByText("You answered this card")).toBeNull();
  });
});

describe("given a command that runs under a time limit", () => {
  /** @scenario "The card names the time limit the command runs under" */
  it("says after how long the command is stopped", () => {
    renderCard({ card: { ...PENDING, timeoutSeconds: 300 } });

    expect(
      screen.getByText("Stops after 5 minutes if it has not finished."),
    ).toBeDefined();
  });

  it("says nothing about a limit when the command runs under none", () => {
    renderCard();
    expect(screen.queryByText(/Stops after/)).toBeNull();
  });
});

describe("when the answer is sent", () => {
  /** @scenario "A pattern grant names the pattern it covers on the settled card" */
  it("settles the card with the decision, before the record carries it back", () => {
    renderCard();
    fireEvent.click(screen.getByText('Allow "pnpm *" this session'));

    expect(useLangyLocalControlStore.getState().waits["wait-1"]).toMatchObject({
      status: "answered",
      decision: "allow_pattern",
    });
  });
});

describe("given the command line offered no session grant", () => {
  it("offers only the single answer and the denial", () => {
    renderCard({ card: { ...PENDING, pattern: null, patterns: [] } });

    expect(screen.getByText("Allow once")).toBeDefined();
    expect(screen.queryByText(/this session$/)).toBeNull();
  });
});
