/**
 * @vitest-environment jsdom
 * The code access card's four states (ADR-129): fixtures are
 * `langy.getLocalWorkspace` answers, not tool payloads. Boundary mocks:
 * tRPC hooks and the GitHub connect popup.
 * @see specs/langy/langy-code-access.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setPreference = vi.fn();
const refetchWorkspace = vi.fn();
const renewRequest = vi.fn();
let workspaceData: unknown = null;
let workspaceError: unknown = null;
let githubInstallations: {
  installationId: string;
  accountLogin: string;
}[] = [];

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../../../behavior/github-connect-popup.ts", () => ({
  useGitHubConnectPopup: () => ({
    connect: vi.fn(async () => ({ ok: true, login: "acme" })),
  }),
}));

vi.mock("../../../../../behavior/langy-api.ts", () => ({
  api: {
    langy: {
      getLocalWorkspace: {
        useQuery: () => ({
          data: workspaceData,
          isLoading: workspaceData === null && workspaceError === null,
          isError: workspaceError !== null,
          error: workspaceError,
          refetch: refetchWorkspace,
        }),
      },
      renewLocalControlRequest: {
        useMutation: () => ({
          mutate: (input: unknown, options?: { onSuccess?: () => void }) => {
            renewRequest(input);
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

import { writeLocalFolderPick } from "../../../../../model/langy-code-access-pick.ts";
import { LangyCodeAccessCard } from "../../../../../ui/sections/derived-cards/langy-code-access-card.tsx";

afterEach(cleanup);

beforeEach(() => {
  setPreference.mockClear();
  refetchWorkspace.mockClear();
  renewRequest.mockClear();
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
  requestState: "none",
  codeAccessPreference: null,
};

function renderCard(over: Partial<Parameters<typeof LangyCodeAccessCard>[0]> = {}) {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <LangyCodeAccessCard
        projectId="p_1"
        conversationId="c_1"
        callId="call-1"
        organizationId="org_1"
        onChoiceSelect={vi.fn()}
        onAskAgain={vi.fn()}
        {...over}
      />
    </DesignSystemProvider>,
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
    expect(screen.getByText("Fastest: I run the toolchain you already have")).toBeDefined();
    expect(screen.getByText("Connect to GitHub")).toBeDefined();
    expect(
      screen.getByText("I open a pull request through the LangWatch GitHub App"),
    ).toBeDefined();
    // Whether the app can open a pull request today is part of the option.
    expect(screen.getByText("Installed on acme")).toBeDefined();
  });

  /** @scenario "A code access call without the offer shows no describe option" */
  it("offers no describe link unless the tool asked for it", () => {
    renderCard();
    expect(screen.queryByText("I'd rather describe it")).toBeNull();
  });

  /** @scenario "The describe option shows only when the tool offered it" */
  it("draws the quiet describe link under the two actions when offered", () => {
    renderCard({ offerDescribe: true });

    const describeLink = screen.getByTestId("langy-code-access-describe");
    expect(describeLink.textContent).toBe("I'd rather describe it");
    const options = screen.getAllByTestId("langy-code-access-option");
    expect(options).toHaveLength(2);
    expect(
      options[1]!.compareDocumentPosition(describeLink) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  /** @scenario "Picking describe answers as my own message" */
  it("answers the describe pick through the choices path, requesting no folder", () => {
    const onChoiceSelect = vi.fn();
    renderCard({ offerDescribe: true, onChoiceSelect });

    fireEvent.click(screen.getByTestId("langy-code-access-describe"));

    expect(onChoiceSelect).toHaveBeenCalledTimes(1);
    const [{ selection, card }] = onChoiceSelect.mock.calls[0]!;
    expect(selection).toEqual({ blockId: "code-access:call-1", optionIds: ["describe"] });
    expect(card.options.map((option: { id: string }) => option.id)).toEqual([
      "local",
      "github",
      "describe",
    ]);
    expect(card.options[2]).toMatchObject({ label: "I'd rather describe it", quiet: true });
    expect(screen.queryByText("Run this in the folder you want me to work in:")).toBeNull();
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
    workspaceData = {
      ...ASKING,
      requestState: "open",
      pendingRequest: { id: "req_1", expiresAt: new Date(10_000 + 5 * 60_000).toISOString() },
    };
    renderCard({ now: () => 10_000 });
    fireEvent.click(screen.getByText("Share local folder"));

    expect(screen.getByText("Run this in the folder you want me to work in:")).toBeDefined();
    expect(screen.getByText("npx langwatch@latest langy --share-control")).toBeDefined();
    expect(screen.getByText(/Waiting for you to approve in the terminal/)).toBeDefined();
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
        screen.getByText("Install the LangWatch GitHub App so I can open the pull request"),
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
        screen.getByText("Install the LangWatch GitHub App so I can open the pull request"),
      ).toBeDefined();
    });
  });
});

describe("given a request the terminal has not approved yet", () => {
  beforeEach(() => {
    workspaceData = {
      ...ASKING,
      requestState: "open",
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
    expect(screen.queryByText("npx langwatch@latest langy --share-control")).toBeNull();
  });

  it("shows the command and the countdown once the folder is chosen", () => {
    renderCard({ now: () => 10_000 });
    fireEvent.click(screen.getByText("Share local folder"));

    expect(screen.getByText(/Waiting for you to approve in the terminal/)).toBeDefined();
    expect(screen.getByText(/Expires in 5 minutes/)).toBeDefined();
  });

  /** @scenario "A card left waiting is still waiting after a reload" */
  it("opens on the waiting state again after the card is remounted", () => {
    const first = renderCard({ now: () => 10_000 });
    fireEvent.click(screen.getByText("Share local folder"));
    first.unmount();

    renderCard({ now: () => 10_000 });

    expect(screen.getByText("npx langwatch@latest langy --share-control")).toBeDefined();
    expect(screen.queryByText("How should I reach your code?")).toBeNull();
  });
});

describe("given a picked card whose request is over", () => {
  const pickAndRender = (requestState: string, over = {}) => {
    workspaceData = { ...ASKING, requestState };
    writeLocalFolderPick({ conversationId: "c_1", callId: "call-1" });
    return renderCard({ onAskAgain: vi.fn(), ...over });
  };

  /** @scenario "A card reopened after its request expired says so" */
  it("says the request expired, shows no waiting line and offers to try again", () => {
    pickAndRender("expired");

    expect(screen.getByText("This request expired.")).toBeDefined();
    expect(screen.queryByText(/Waiting for you to approve/)).toBeNull();
    expect(screen.queryByText("npx langwatch@latest langy --share-control")).toBeNull();
    expect(screen.getByText("Try again")).toBeDefined();
  });

  /** @scenario "A waiting card turns expired when its time runs out" */
  it("turns expired and reads the folder state again when the countdown reaches zero", () => {
    workspaceData = {
      ...ASKING,
      requestState: "open",
      pendingRequest: { id: "req_1", expiresAt: new Date(10_000 + 60_000).toISOString() },
    };
    writeLocalFolderPick({ conversationId: "c_1", callId: "call-1" });

    renderCard({ now: () => 10_000 + 61_000, onAskAgain: vi.fn() });

    expect(screen.getByText("This request expired.")).toBeDefined();
    expect(screen.getByText("Try again")).toBeDefined();
    expect(refetchWorkspace).toHaveBeenCalled();
  });

  /** @scenario "Trying again opens a fresh request on the same card" */
  it("records a fresh request for the same conversation and sends no message", () => {
    const onChoiceSelect = vi.fn();
    pickAndRender("expired", { onChoiceSelect });

    fireEvent.click(screen.getByText("Try again"));

    expect(renewRequest).toHaveBeenCalledWith({ projectId: "p_1", conversationId: "c_1" });
    expect(onChoiceSelect).not.toHaveBeenCalled();
    expect(refetchWorkspace).toHaveBeenCalled();
  });

  /** @scenario "A request declined in the terminal reads as declined" */
  it("says the request was declined in the terminal and offers to try again", () => {
    pickAndRender("declined");

    expect(screen.getByText("This request was declined in the terminal.")).toBeDefined();
    expect(screen.getByText("Try again")).toBeDefined();
  });

  /** @scenario "A share that ended offers to share again" */
  it("says sharing stopped and offers to share again", () => {
    pickAndRender("ended");

    expect(screen.getByText("Sharing stopped.")).toBeDefined();
    expect(screen.getByText("Share again")).toBeDefined();
  });
});

describe("given a fresh card whose request already expired", () => {
  /** @scenario "Choosing the local folder after the request expired opens a fresh one" */
  it("opens a fresh request for the same conversation when the folder is chosen", () => {
    workspaceData = { ...ASKING, requestState: "expired" };
    renderCard();

    fireEvent.click(screen.getByText("Share local folder"));

    expect(renewRequest).toHaveBeenCalledWith({ projectId: "p_1", conversationId: "c_1" });
    expect(refetchWorkspace).toHaveBeenCalled();
  });
});

describe("given Langy asked again further down the conversation", () => {
  beforeEach(() => {
    workspaceData = ASKING;
  });

  /** @scenario "Only the newest code access card can be answered" */
  it("reads as closed, points at the newer card, and answers nothing", () => {
    const { container } = renderCard({ superseded: true });

    expect(screen.getByText("Asked again further down. Answer the newer card.")).toBeDefined();
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
      screen.getByText("Connected: /Users/rogerio/Projects/acme-app on rogerio-mbp, branch main"),
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
