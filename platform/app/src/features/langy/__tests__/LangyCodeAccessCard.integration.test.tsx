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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setPreference = vi.fn();
const refetchWorkspace = vi.fn();
let workspaceData: unknown = null;
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
        useQuery: () => ({
          data: workspaceData,
          isLoading: workspaceData === null,
          refetch: refetchWorkspace,
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
  githubInstallations = [{ installationId: "i1", accountLogin: "acme" }];
});

const ASKING = {
  connected: false,
  workspace: null,
  skipAllowed: false,
  skipPermissions: false,
  pendingRequest: null,
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
    expect(screen.getByText("Share my local folder")).toBeDefined();
    expect(
      screen.getByText("Fastest: I run the toolchain you already have"),
    ).toBeDefined();
    expect(screen.getByText("Use GitHub")).toBeDefined();
    expect(
      screen.getByText(
        "I open a pull request through the LangWatch GitHub App",
      ),
    ).toBeDefined();
    // Whether the app can open a pull request today is part of the option.
    expect(screen.getByText("Installed on acme")).toBeDefined();
  });

  /** @scenario "The local folder is never remembered" */
  it("says only GitHub is remembered", () => {
    renderCard();
    expect(
      screen.getByText(
        "Only GitHub is remembered. A folder is shared again each time.",
      ),
    ).toBeDefined();
  });

  /** @scenario "Choosing the local folder turns the card into the waiting state" */
  it("turns into the waiting state, with the command and the countdown", () => {
    renderCard();
    fireEvent.click(screen.getByText("Share my local folder"));

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

    fireEvent.click(screen.getByText("Use GitHub"));

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
    fireEvent.click(screen.getByText("Use GitHub"));

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
      fireEvent.click(screen.getByText("Use GitHub"));

      expect(
        screen.getByText(
          "Install the LangWatch GitHub App so I can open the pull request",
        ),
      ).toBeDefined();
      expect(onChoiceSelect).not.toHaveBeenCalled();
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

  it("opens on the waiting state and says when the request expires", () => {
    renderCard({ now: () => 10_000 });

    expect(
      screen.getByText(/Waiting for you to approve in the terminal/),
    ).toBeDefined();
    expect(screen.getByText(/Expires in 5 minutes/)).toBeDefined();
  });

  describe("when the request has run out", () => {
    it("says so and offers to ask again", () => {
      const onAskAgain = vi.fn();
      renderCard({ now: () => 10_000 + 20 * 60_000, onAskAgain });

      expect(screen.getByText("Request expired, ask again")).toBeDefined();
      fireEvent.click(screen.getByText("Ask again"));
      expect(onAskAgain).toHaveBeenCalledTimes(1);
    });
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

describe("given GitHub was remembered", () => {
  beforeEach(() => {
    workspaceData = { ...ASKING, codeAccessPreference: "github" };
  });

  /** @scenario "Remembering GitHub answers the next conversation without a card" */
  it("reads as a status line, with a way to change it", () => {
    renderCard();
    expect(screen.getByText("Using GitHub (remembered)")).toBeDefined();
    expect(screen.queryByText("Share my local folder")).toBeNull();
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
