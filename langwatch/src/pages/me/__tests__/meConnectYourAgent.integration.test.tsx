/**
 * @vitest-environment jsdom
 *
 * Covers specs/ai-governance/personal-portal/connect-your-agent-button.feature.
 *
 * Full-tree: the real MyUsagePage renders, feature-flag guard included, with
 * every section live. MyLayout is stubbed at its module seam (pure chrome
 * with its own specs) and the tRPC surface is a proxy that answers every
 * query empty unless a test pins it. The two pinned reads are the personal
 * context (which project the /me home watches) and
 * project.getHasFirstMessage, the same Project.firstMessage signal the
 * authorize page's first-trace watch polls, reused here as the button's
 * appearance gate.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  queryImpls,
  hasFirstMessageRef,
  hasFirstMessageInputs,
  canAskMock,
  askLangyMock,
  toasterCreateMock,
} = vi.hoisted(() => {
  const defaultQuery = () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    isFetched: true,
  });

  /** Whether the personal project has ever received a trace; undefined = unresolved. */
  const hasFirstMessageRef = { current: undefined as boolean | undefined };
  const hasFirstMessageInputs: unknown[] = [];

  const queryImpls: Record<string, (input: unknown) => unknown> = {
    "user.personalContext": () => ({
      data: {
        workspace: {
          team: { createdAt: new Date("2026-01-05T00:00:00Z") },
          project: { id: "proj-personal", slug: "personal-proj" },
        },
        routingPolicy: null,
      },
      isLoading: false,
      isError: false,
      isFetched: true,
    }),
    "project.getHasFirstMessage": (input: unknown) => {
      hasFirstMessageInputs.push(input);
      return {
        data:
          hasFirstMessageRef.current === undefined
            ? undefined
            : { firstMessage: hasFirstMessageRef.current },
        isLoading: hasFirstMessageRef.current === undefined,
        isError: false,
        isFetched: hasFirstMessageRef.current !== undefined,
      };
    },
    "aiTools.list": () => ({ data: [], isLoading: false, isError: false }),
    "aiTools.providerAvailability": () => ({
      data: { configuredProviders: [] },
      isLoading: false,
      isError: false,
    }),
    "ingestionTemplates.list": () => ({
      data: [],
      isLoading: false,
      isError: false,
    }),
    "ingestionKey.list": () => ({ data: [], isLoading: false, isError: false }),
  };

  return {
    defaultQuery,
    queryImpls,
    hasFirstMessageRef,
    hasFirstMessageInputs,
    canAskMock: vi.fn(() => true),
    askLangyMock: vi.fn(),
    toasterCreateMock: vi.fn(),
  };
});

vi.mock("~/utils/api", () => {
  const defaultQuery = () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    isFetched: true,
  });
  // Any depth of utils access (api.useUtils().x.y.invalidate()) resolves to a
  // callable that answers with a resolved promise.
  const chainable: unknown = new Proxy(() => Promise.resolve(undefined), {
    get: (_target, prop) => (typeof prop === "string" ? chainable : undefined),
    apply: () => Promise.resolve(undefined),
  });
  const useMutationStub = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(() => Promise.resolve(undefined)),
    isPending: false,
    isLoading: false,
    reset: vi.fn(),
  });
  // The hooks a node answers itself, keyed by name; a Map so ordinary object
  // members (constructor, toString) keep nesting instead of resolving here.
  const hooksFor = (path: string): Map<string, unknown> => {
    const useQuery = (input: unknown) =>
      (queryImpls[path] ?? defaultQuery)(input);
    return new Map<string, unknown>([
      ["useUtils", () => chainable],
      ["useContext", () => chainable],
      ["useQuery", useQuery],
      ["useInfiniteQuery", useQuery],
      ["useMutation", useMutationStub],
    ]);
  };
  // Every node can act as a procedure (useQuery/useMutation) or nest further,
  // so root-level procedures (api.publicEnv) and router-nested ones
  // (api.user.personalContext) both resolve; queryImpls keys by dotted path.
  const makeNode = (path: string): unknown => {
    const hooks = hooksFor(path);
    return new Proxy(
      {},
      {
        get: (_target, prop) =>
          typeof prop === "string"
            ? (hooks.get(prop) ?? makeNode(path ? `${path}.${prop}` : prop))
            : undefined,
      },
    );
  };
  return { api: makeNode("") };
});

// Chrome, not behavior: MyLayout drags the whole DashboardLayout shell in.
// Its own contract lives in the my-usage-dashboard / persona-aware-chrome
// specs; the page content underneath is what this file exercises.
vi.mock("~/components/me/MyLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("~/hooks/useFeatureFlag", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/hooks/useFeatureFlag")>();
  return {
    ...actual,
    useFeatureFlag: () => ({ enabled: true, isLoading: false }),
  };
});

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1", name: "Acme" },
    organizations: [],
    project: undefined,
    team: undefined,
    hasPermission: () => true,
    isLoading: false,
    isFetched: true,
  }),
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({
    data: { user: { id: "user-1", email: "dev@example.com", name: "Dev" } },
    status: "authenticated",
  }),
}));

vi.mock("~/features/langy/hooks/useCanAskLangy", () => ({
  useCanAskLangy: () => canAskMock(),
}));

vi.mock("~/features/langy/stores/langyStore", () => {
  const state: Record<string, unknown> = {
    askLangy: askLangyMock,
    isOpen: false,
    dockShifted: false,
    claimDockShell: vi.fn(),
    releaseDockShell: vi.fn(),
  };
  // Shaped like a zustand hook: callable with a selector, and carrying the
  // store statics (langyContextTargetStore subscribes at module scope).
  const useLangyStore = (
    selector: (current: Record<string, unknown>) => unknown,
  ) => selector(state);
  useLangyStore.subscribe = () => () => undefined;
  useLangyStore.getState = () => state;
  useLangyStore.setState = () => undefined;
  return { useLangyStore };
});

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: (...args: unknown[]) => toasterCreateMock(...args) },
}));

vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

vi.mock("~/hooks/useReducedMotion", () => ({
  useReducedMotion: () => false,
}));

import {
  EXPLORE_USAGE_AGENT_PROMPT,
  EXPLORE_USAGE_DOCS_PATH,
  EXPLORE_USAGE_LANGY_PROMPT,
} from "~/components/me/ConnectYourAgentButton";
import MyUsagePage from "../index";

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MyUsagePage />
    </ChakraProvider>,
  );
}

const connectButton = () =>
  screen.queryByRole("button", { name: /connect your agent/i });

/** Renders the page and hands the menu trigger back for the test to assert on. */
function renderMenuTrigger() {
  const user = userEvent.setup();
  renderPage();
  return { user, trigger: connectButton() };
}

beforeEach(() => {
  vi.clearAllMocks();
  canAskMock.mockReturnValue(true);
  hasFirstMessageRef.current = true;
});

describe("the /me usage home's Connect your agent button, given a personal project with no traces yet", () => {
  /** @scenario the /me home hides Connect your agent before the first trace */
  it("stays absent while the first-traces flag is false or unresolved", () => {
    hasFirstMessageRef.current = false;
    renderPage();
    // The page itself is alive (heading rendered), the button is not.
    expect(screen.getByText("My Usage")).toBeDefined();
    expect(connectButton()).toBeNull();
    // The gate read the SAME first-traces signal the authorize page
    // watches, for the personal project the /me home resolves.
    expect(hasFirstMessageInputs).toContainEqual({
      projectId: "proj-personal",
    });
  });
});

describe("the /me usage home's Connect your agent button, given a personal project with traces", () => {
  /** @scenario the /me home shows Connect your agent once the personal project has traces */
  it("renders the menu button in the My Usage header", () => {
    renderPage();
    expect(connectButton()).not.toBeNull();
  });

  /** @scenario the menu offers Langy exploration, a coding-agent prompt, and the guide */
  it("offers the three exploration routes", async () => {
    const { user, trigger } = renderMenuTrigger();
    expect(trigger).not.toBeNull();
    await user.click(trigger!);
    await screen.findByText("Explore via Langy");
    screen.getByText("Ask Langy where your tokens went");
    screen.getByText("Explore via your coding agent");
    screen.getByText(/copy a prompt so claude code can inspect/i);
    const guide = screen.getByText("Read the guide");
    expect(guide.closest("a")?.getAttribute("href")).toContain(
      EXPLORE_USAGE_DOCS_PATH,
    );
  });

  /** @scenario Explore via Langy hands Langy a usage-exploration prompt */
  it("seeds Langy with the usage-exploration prompt", async () => {
    const { user, trigger } = renderMenuTrigger();
    expect(trigger).not.toBeNull();
    await user.click(trigger!);
    await user.click(await screen.findByText("Explore via Langy"));
    expect(askLangyMock).toHaveBeenCalledWith(EXPLORE_USAGE_LANGY_PROMPT);
    expect(EXPLORE_USAGE_LANGY_PROMPT).toMatch(/where did my tokens go/i);
  });

  /** @scenario copying the exploration prompt arms a coding agent to self-inspect */
  it("puts the self-inspection prompt on the clipboard and confirms", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    // navigator.clipboard is getter-only in jsdom; redefine over whatever
    // user-event installed so the component's call is observable.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderPage();
    await user.click(connectButton()!);
    await user.click(await screen.findByText("Explore via your coding agent"));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(EXPLORE_USAGE_AGENT_PROMPT),
    );
    await waitFor(() =>
      expect(toasterCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "success" }),
      ),
    );
    // The prompt must let a fresh coding-agent session self-inspect: the
    // CLI's device login carries the credentials, and the commands named
    // are the trace and spend reads.
    expect(EXPLORE_USAGE_AGENT_PROMPT).toMatch(/no API key/i);
    expect(EXPLORE_USAGE_AGENT_PROMPT).toMatch(/device login/i);
    expect(EXPLORE_USAGE_AGENT_PROMPT).toContain("langwatch trace search");
    expect(EXPLORE_USAGE_AGENT_PROMPT).toContain(
      "langwatch analytics query -m total-cost",
    );
  });

  /** @scenario readers who cannot ask Langy keep the prompt and guide routes */
  it("drops the Langy route without langy:create but keeps the rest", async () => {
    canAskMock.mockReturnValue(false);
    const { user, trigger } = renderMenuTrigger();
    expect(trigger).not.toBeNull();
    await user.click(trigger!);
    await screen.findByText("Explore via your coding agent");
    expect(screen.queryByText("Explore via Langy")).toBeNull();
    screen.getByText("Read the guide");
  });
});

describe("the docs guide", () => {
  /** @scenario the docs guide carries the same coding-agent prompt the menu copies */
  it("contains the exact prompt the menu puts on the clipboard", () => {
    const docsFile = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../..",
      "docs/ai-governance/explore-your-usage-with-your-own-agent.mdx",
    );
    const contents = readFileSync(docsFile, "utf-8");
    expect(contents).toContain(EXPLORE_USAGE_AGENT_PROMPT);
  });
});
