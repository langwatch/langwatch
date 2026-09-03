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
        useMutation: () => ({ mutate: answerPermission, isPending: false }),
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

afterEach(cleanup);
beforeEach(() => {
  answerPermission.mockClear();
  setLocalPolicy.mockClear();
});

const PENDING: LangyPermissionCardData = {
  waitId: "wait-1",
  status: "pending",
  decision: null,
  command: "pnpm typecheck",
  pattern: "pnpm *",
  reason: "Runs the project's own type check before I commit",
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
});

describe("given the command line offered no session grant", () => {
  it("offers only the single answer and the denial", () => {
    renderCard({ card: { ...PENDING, pattern: null } });

    expect(screen.getByText("Allow once")).toBeDefined();
    expect(screen.queryByText(/this session$/)).toBeNull();
  });
});
