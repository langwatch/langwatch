/**
 * @vitest-environment jsdom
 *
 * The code access card (ADR-129, specs/langy/langy-code-access.feature) — the
 * one question Langy asks before it changes the customer's own program, and
 * the four states the answer puts it in.
 *
 * Every state is read from `langy.getLocalWorkspace`, so the fixtures here are
 * that query's answers rather than tool payloads: the folder can connect after
 * the turn ends and the remembered choice can be cleared elsewhere, and the
 * card has to be right in both cases.
 *
 * Boundary mocks: the tRPC hooks the card calls, and the GitHub connect popup
 * the install path opens.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setPreference = vi.fn();
const refetchWorkspace = vi.fn();
const renewRequest = vi.fn();
let workspaceData: unknown = null;
/** What the platform answers once a fresh request is opened. */
let workspaceAfterRenew: unknown = null;
const workspaceListeners = new Set<() => void>();
/** A new answer from the platform, as a refetch delivers it to a mounted card. */
function answerWorkspace(data: unknown) {
  workspaceData = data;
  for (const listener of workspaceListeners) listener();
}
let workspaceError: unknown = null;
let githubInstallations: Array<{
  installationId: string;
  accountLogin: string;
}> = [];

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("~/features/github/useGitHubConnectPopup", () => ({
  useGitHubConnectPopup: () => ({
    connect: vi.fn(async () => ({ ok: true, login: "acme" })),
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    langy: {
      getLocalWorkspace: {
        useQuery: () => {
          const data = useSyncExternalStore(
            (listener) => {
              workspaceListeners.add(listener);
              return () => workspaceListeners.delete(listener);
            },
            () => workspaceData,
          );
          return {
            data,
            isLoading: data === null && workspaceError === null,
            isError: workspaceError !== null,
            error: workspaceError,
            refetch: refetchWorkspace,
          };
        },
      },
      renewLocalControlRequest: {
        useMutation: () => ({
          mutate: (input: unknown, options?: { onSuccess?: () => void }) => {
            renewRequest(input);
            if (workspaceAfterRenew) answerWorkspace(workspaceAfterRenew);
            options?.onSuccess?.();
          },
          isPending: false,
        }),
      },
      setCodeAccessPreference: {
        useMutation: () => ({
          mutate: (input: unknown, options?: { onSuccess?: () => void }) => {
            setPreference(input);
            options?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
    github: {
      getConnectionStatus: {
        useQuery: () => ({
          data: { installations: githubInstallations },
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

import { LangyCodeAccessCard } from "../components/derived-cards/LangyCodeAccessCard";

afterEach(cleanup);

beforeEach(() => {
  setPreference.mockClear();
  refetchWorkspace.mockClear();
  renewRequest.mockClear();
  workspaceAfterRenew = null;
  workspaceError = null;
  githubInstallations = [{ installationId: "i1", accountLogin: "acme" }];
  // The local-folder pick persists per browser, so one test's click would
  // otherwise open the next test's card already waiting.
  localStorage.clear();
});

const ASKING = {
  connected: false,
  workspace: null,
  skipAllowed: false,
  skipPermissions: false,
  pendingRequest: null,
  requestState: "open",
  codeAccessPreference: null,
};

function renderCard(
  over: Partial<Parameters<typeof LangyCodeAccessCard>[0]> = {},
) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyCodeAccessCard
        projectId="p_1"
        conversationId="c_1"
        callId="call-1"
        organizationId="org_1"
        onChoiceSelect={vi.fn()}
        onAskAgain={vi.fn()}
        {...over}
      />
    </ChakraProvider>,
  );
}

describe("given no folder and nothing remembered", () => {
  beforeEach(() => {
    workspaceData = ASKING;
  });

  /** @scenario "The card explains each option in the customer's words" */
  it("offers the two ways to reach the code, in the reader's own words", () => {
    renderCard();

    expect(screen.getByText("How should I reach your code?")).toBeDefined();
    expect(screen.getByText("Share local folder")).toBeDefined();
    expect(
      screen.getByText("Fastest: I run the toolchain you already have"),
    ).toBeDefined();
    expect(screen.getByText("Connect to GitHub")).toBeDefined();
    expect(
      screen.getByText(
        "I open a pull request through the LangWatch GitHub App",
      ),
    ).toBeDefined();
    // Whether the app can open a pull request today is part of the option.
    expect(screen.getByText("Installed on acme")).toBeDefined();
  });

  /** @scenario "The code access card shows the folder and GitHub actions" */
  it("draws a folder icon on the local action and the GitHub mark on the other", () => {
    renderCard();

    const options = screen.getAllByTestId("langy-code-access-option");
    expect(options).toHaveLength(2);
    expect(options[0]!.querySelector("svg.lucide-folder-open")).not.toBeNull();
    expect(options[1]!.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0 0 98 96",
    );
  });

  /** @scenario "A code access call without the offer shows no describe option" */
  it("offers no describe link unless the tool asked for it", () => {
    renderCard();
    expect(screen.queryByText("I'd rather describe it")).toBeNull();
  });

  /** @scenario "The describe option shows only when the tool offered it" */
  it("draws the quiet describe link under the two actions when offered", () => {
    renderCard({ offerDescribe: true });

    const describe = screen.getByTestId("langy-code-access-describe");
    expect(describe.textContent).toBe("I'd rather describe it");
    // The link sits below the two bordered actions, and is not one of them.
    const options = screen.getAllByTestId("langy-code-access-option");
    expect(options).toHaveLength(2);
    expect(
      options[1]!.compareDocumentPosition(describe) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  /** @scenario "Picking describe answers as my own message" */
  it("answers the describe pick through the choices path, requesting no folder", () => {
    const onChoiceSelect = vi.fn();
    renderCard({ offerDescribe: true, onChoiceSelect });

    fireEvent.click(screen.getByTestId("langy-code-access-describe"));

    expect(onChoiceSelect).toHaveBeenCalledTimes(1);
    const [{ selection, card }] = onChoiceSelect.mock.calls[0]!;
    expect(selection).toEqual({
      blockId: "code-access:call-1",
      optionIds: ["describe"],
    });
    expect(card.options.map((option: { id: string }) => option.id)).toEqual([
      "local",
      "github",
      "describe",
    ]);
    expect(card.options[2]).toMatchObject({
      label: "I'd rather describe it",
      quiet: true,
    });
    // No folder was picked, so the card is not waiting on the terminal.
    expect(
      screen.queryByText("Run this in the folder you want me to work in:"),
    ).toBeNull();
  });

  /** @scenario "The local folder is never remembered" */
  it("stores nothing when the folder is shared with the box ticked", () => {
    const onChoiceSelect = vi.fn();
    renderCard({ onChoiceSelect });

    fireEvent.click(screen.getByTestId("langy-remember-code-access"));
    fireEvent.click(screen.getByText("Share local folder"));

    expect(setPreference).not.toHaveBeenCalled();
  });

  /** @scenario "Choosing the local folder turns the card into the waiting state" */
  it("turns into the waiting state, with the command and the countdown", () => {
    renderCard();
    fireEvent.click(screen.getByText("Share local folder"));

    expect(
      screen.getByText("Run this in the folder you want me to work in:"),
    ).toBeDefined();
    expect(
      screen.getByText("npx langwatch@latest langy --share-control"),
    ).toBeDefined();
    expect(
      screen.getByText(/Waiting for you to approve in the terminal/),
    ).toBeDefined();
  });

  /** @scenario "Choosing GitHub continues on the existing pull request path" */
  it("answers with the GitHub choice, and remembers nothing unless asked", () => {
    const onChoiceSelect = vi.fn();
    renderCard({ onChoiceSelect });

    fireEvent.click(screen.getByText("Connect to GitHub"));

    expect(onChoiceSelect).toHaveBeenCalledTimes(1);
    expect(onChoiceSelect.mock.calls[0]?.[0]).toMatchObject({
      selection: { blockId: "code-access:call-1", optionIds: ["github"] },
    });
    expect(setPreference).not.toHaveBeenCalled();
  });

  it("remembers the choice when the box is ticked", () => {
    const onChoiceSelect = vi.fn();
    renderCard({ onChoiceSelect });

    fireEvent.click(screen.getByTestId("langy-remember-code-access"));
    fireEvent.click(screen.getByText("Connect to GitHub"));

    expect(setPreference).toHaveBeenCalledWith({
      projectId: "p_1",
      preference: "github",
    });
    expect(onChoiceSelect).toHaveBeenCalledTimes(1);
  });

  describe("when the GitHub App is not installed", () => {
    beforeEach(() => {
      githubInstallations = [];
    });

    /** @scenario "Choosing GitHub without the app installed shows the install card" */
    it("shows the install card and attempts no pull request", () => {
      const onChoiceSelect = vi.fn();
      renderCard({ onChoiceSelect });

      expect(screen.getByText("Install the app first")).toBeDefined();
      fireEvent.click(screen.getByText("Connect to GitHub"));

      expect(
        screen.getByText(
          "Install the LangWatch GitHub App so I can open the pull request",
        ),
      ).toBeDefined();
      expect(onChoiceSelect).not.toHaveBeenCalled();
    });

    /** @scenario "The remembered choice is stored before the install card opens" */
    it("stores the ticked choice on the way into the install card", () => {
      renderCard();

      fireEvent.click(screen.getByTestId("langy-remember-code-access"));
      fireEvent.click(screen.getByText("Connect to GitHub"));

      expect(setPreference).toHaveBeenCalledWith({
        projectId: "p_1",
        preference: "github",
      });
      expect(
        screen.getByText(
          "Install the LangWatch GitHub App so I can open the pull request",
        ),
      ).toBeDefined();
    });
  });
});

describe("given a request the terminal has not approved yet", () => {
  beforeEach(() => {
    workspaceData = {
      ...ASKING,
      pendingRequest: {
        id: "req_1",
        expiresAt: new Date(10_000 + 5 * 60_000).toISOString(),
      },
    };
  });

  /** @scenario "A fresh card asks even though the request to share a folder exists" */
  it("still asks, because the reader has not chosen anything yet", () => {
    renderCard({ now: () => 10_000 });

    expect(screen.getByText("How should I reach your code?")).toBeDefined();
    expect(screen.getByText("Connect to GitHub")).toBeDefined();
    expect(
      screen.queryByText("npx langwatch@latest langy --share-control"),
    ).toBeNull();
  });

  it("shows the command and the countdown once the folder is chosen", () => {
    renderCard({ now: () => 10_000 });
    fireEvent.click(screen.getByText("Share local folder"));

    expect(
      screen.getByText(/Waiting for you to approve in the terminal/),
    ).toBeDefined();
    expect(screen.getByText(/Expires in 5 minutes/)).toBeDefined();
  });

  /** @scenario "A card left waiting is still waiting after a reload" */
  it("opens on the waiting state again after the card is remounted", () => {
    const first = renderCard({ now: () => 10_000 });
    fireEvent.click(screen.getByText("Share local folder"));
    first.unmount();

    renderCard({ now: () => 10_000 });

    expect(
      screen.getByText("npx langwatch@latest langy --share-control"),
    ).toBeDefined();
    expect(screen.queryByText("How should I reach your code?")).toBeNull();
  });

  describe("when the request's time runs out while the card is on screen", () => {
    afterEach(() => vi.useRealTimers());

    /** @scenario "A waiting card turns expired when its time runs out" */
    it("turns expired, offers to try again and reads the folder state again", () => {
      vi.useFakeTimers();
      let clock = 10_000;
      renderCard({ now: () => clock });
      fireEvent.click(screen.getByText("Share local folder"));
      expect(
        screen.getByText(/Waiting for you to approve in the terminal/),
      ).toBeDefined();
      expect(refetchWorkspace).not.toHaveBeenCalled();

      clock = 10_000 + 6 * 60_000;
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(screen.getByText("This request expired.")).toBeDefined();
      expect(screen.getByText("Try again")).toBeDefined();
      expect(
        screen.queryByText(/Waiting for you to approve in the terminal/),
      ).toBeNull();
      expect(refetchWorkspace).toHaveBeenCalledTimes(1);
    });
  });
});

describe("given I chose the local folder and the request is over", () => {
  const OPEN = {
    ...ASKING,
    pendingRequest: {
      id: "req_1",
      expiresAt: new Date(10_000 + 5 * 60_000).toISOString(),
    },
  };
  const over = (requestState: string) => ({
    ...ASKING,
    pendingRequest: null,
    requestState,
  });

  /** The card as it is reopened: the pick was made while the request was open. */
  function reopenWith(
    data: unknown,
    props: Parameters<typeof renderCard>[0] = {},
  ) {
    workspaceData = OPEN;
    const first = renderCard({ now: () => 10_000 });
    fireEvent.click(screen.getByText("Share local folder"));
    first.unmount();
    workspaceData = data;
    return renderCard({ now: () => 10_000 + 60 * 60_000, ...props });
  }

  /** @scenario "A card reopened after its request expired says so" */
  it("says the request expired, with no waiting line and no spinner", () => {
    const { container } = reopenWith(over("expired"));

    expect(screen.getByText("This request expired.")).toBeDefined();
    expect(screen.getByText("Try again")).toBeDefined();
    expect(
      screen.queryByText(/Waiting for you to approve in the terminal/),
    ).toBeNull();
    expect(container.querySelector(".chakra-spinner")).toBeNull();
    expect(
      screen.queryByText("npx langwatch@latest langy --share-control"),
    ).toBeNull();
  });

  /** @scenario "Trying again opens a fresh request on the same card" */
  it("opens a fresh request and goes back to the command and a countdown", () => {
    const onChoiceSelect = vi.fn();
    const onAskAgain = vi.fn();
    reopenWith(over("expired"), { onChoiceSelect, onAskAgain });
    workspaceAfterRenew = {
      ...ASKING,
      pendingRequest: {
        id: "req_2",
        expiresAt: new Date(10_000 + 60 * 60_000 + 15 * 60_000).toISOString(),
      },
    };

    fireEvent.click(screen.getByText("Try again"));

    expect(renewRequest).toHaveBeenCalledWith({
      projectId: "p_1",
      conversationId: "c_1",
    });
    expect(
      screen.getByText("npx langwatch@latest langy --share-control"),
    ).toBeDefined();
    expect(screen.getByText(/Expires in 15 minutes/)).toBeDefined();
    expect(refetchWorkspace).toHaveBeenCalled();
    expect(onChoiceSelect).not.toHaveBeenCalled();
    expect(onAskAgain).not.toHaveBeenCalled();
  });

  /** @scenario "A request declined in the terminal reads as declined" */
  it("says the request was declined in the terminal", () => {
    reopenWith(over("declined"));

    expect(
      screen.getByText("This request was declined in the terminal."),
    ).toBeDefined();
    expect(screen.getByText("Try again")).toBeDefined();
  });

  /** @scenario "A share that ended offers to share again" */
  it("says sharing stopped and offers to share again", () => {
    reopenWith(over("ended"));

    expect(screen.getByText("Sharing stopped.")).toBeDefined();
    fireEvent.click(screen.getByText("Share again"));
    expect(renewRequest).toHaveBeenCalledTimes(1);
  });

  describe("when the conversation is only being read", () => {
    it("says what happened and offers nothing to press", () => {
      reopenWith(over("expired"), {
        onChoiceSelect: undefined,
        onAskAgain: undefined,
      });

      expect(screen.getByText("This request expired.")).toBeDefined();
      expect(screen.queryByText("Try again")).toBeNull();
    });
  });
});

describe("given a fresh card whose request already expired", () => {
  beforeEach(() => {
    workspaceData = { ...ASKING, requestState: "expired" };
    workspaceAfterRenew = {
      ...ASKING,
      pendingRequest: {
        id: "req_2",
        expiresAt: new Date(10_000 + 15 * 60_000).toISOString(),
      },
    };
  });

  /** @scenario "Choosing the local folder after the request expired opens a fresh one" */
  it("opens a fresh request as the folder is chosen", () => {
    renderCard({ now: () => 10_000 });

    fireEvent.click(screen.getByText("Share local folder"));

    expect(renewRequest).toHaveBeenCalledWith({
      projectId: "p_1",
      conversationId: "c_1",
    });
    expect(
      screen.getByText("npx langwatch@latest langy --share-control"),
    ).toBeDefined();
    expect(screen.getByText(/Expires in 15 minutes/)).toBeDefined();
  });
});

describe("given Langy asked again further down the conversation", () => {
  beforeEach(() => {
    workspaceData = ASKING;
  });

  /** @scenario "Only the newest code access card can be answered" */
  it("reads as closed, points at the newer card, and answers nothing", () => {
    const { container } = renderCard({ superseded: true });

    expect(
      screen.getByText("Asked again further down. Answer the newer card."),
    ).toBeDefined();
    expect(screen.queryByText("Share local folder")).toBeNull();
    expect(screen.queryByText("Connect to GitHub")).toBeNull();
    expect(screen.queryByTestId("langy-remember-code-access")).toBeNull();
    expect(container.querySelector('[data-superseded="true"]')).not.toBeNull();
  });
});

describe("given the folder is connected", () => {
  beforeEach(() => {
    workspaceData = {
      ...ASKING,
      connected: true,
      workspace: {
        root: "/Users/rogerio/Projects/acme-app",
        name: "acme-app",
        hostname: "rogerio-mbp",
        gitBranch: "main",
      },
    };
  });

  /** @scenario "A connected folder shows on the card and in the panel header" */
  it("names the folder, the machine and the branch", () => {
    renderCard();
    expect(
      screen.getByText(
        "Connected: /Users/rogerio/Projects/acme-app on rogerio-mbp, branch main",
      ),
    ).toBeDefined();
  });
});

describe("given the read of the folder state fails", () => {
  beforeEach(() => {
    workspaceData = null;
    // The shape a tRPC client error carries a handled error in. The card reads
    // the words off the shared registry, keyed on this code.
    workspaceError = {
      data: {
        error: { code: "langy_conversation_not_found", httpStatus: 404 },
      },
    };
  });

  /** @scenario "A card that cannot read the folder state says so and offers to try again" */
  it("says the read failed, in the shared words, and offers the read again", () => {
    renderCard();

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Conversation not found");
    expect(alert.textContent).toContain("no longer available");
    expect(screen.queryByText("Checking how I can reach your code")).toBeNull();

    fireEvent.click(screen.getByText("Try again"));
    expect(refetchWorkspace).toHaveBeenCalledTimes(1);
  });
});

describe("given GitHub was remembered", () => {
  beforeEach(() => {
    workspaceData = { ...ASKING, codeAccessPreference: "github" };
  });

  /** @scenario "Remembering GitHub answers the next conversation without a card" */
  it("reads as a status line, with a way to change it", () => {
    renderCard();
    expect(screen.getByText("Using GitHub (remembered)")).toBeDefined();
    expect(screen.queryByText("Share local folder")).toBeNull();
    expect(screen.getByText("Change")).toBeDefined();
  });

  /** @scenario "Changing the remembered choice stops the turn and asks again" */
  it("clears the choice and asks the question again", () => {
    const onAskAgain = vi.fn();
    renderCard({ onAskAgain });

    fireEvent.click(screen.getByText("Change"));

    expect(setPreference).toHaveBeenCalledWith({
      projectId: "p_1",
      preference: null,
    });
    expect(onAskAgain).toHaveBeenCalledTimes(1);
  });
});
