/**
 * @vitest-environment jsdom
 *
 * Covers specs/ai-governance/personal-portal/connect-your-agent-button.feature.
 *
 * Full-tree: the real overview screen renders with every section live. The
 * tRPC surface is a proxy that answers every query empty unless a test pins
 * it. The two pinned reads are the personal context (which project the /me
 * home watches) and project.getHasFirstMessage, the same Project.firstMessage
 * signal the authorize page's first-trace watch polls, reused here as the
 * button's appearance gate.
 *
 * THE FLAG GUARD IS NOT HERE ANY MORE, and neither is the chrome. Both moved to
 * the frontend feature that mounts this screen: the guard is stated in
 * `apps/ui`'s route map and covered by its own suite, and the layout is a
 * container. What is left in this file is the page content, which is what it
 * was always about.
 *
 * THE LANGY ROUTE IS GONE from the menu, so its three scenarios no longer bind
 * here. `askLangy` and `useCanAskLangy` are application state a feature-web
 * package may not reach and `apps/ui` has no assistant capability to answer
 * with; recorded in dev/docs/plans/ui-family-move-manifests.md.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryImpls, hasFirstMessageRef, hasFirstMessageInputs } = vi.hoisted(() => {
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
          // Epoch milliseconds, which is what the read hands over and what
          // `usePersonalContext` turns into the joined-on date. The fixture
          // said `createdAt: Date` and the hook has read `createdAtMs` since
          // the personal context grew its DTO, so the page threw on every
          // render of this file rather than rendering the button it is about.
          team: { createdAtMs: Date.parse("2026-01-05T00:00:00Z") },
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
  };
});

vi.mock("../behavior/personal-workspace-api", () => {
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
    const useQuery = (input: unknown) => (queryImpls[path] ?? defaultQuery)(input);
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

vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

import {
  EXPLORE_USAGE_AGENT_PROMPT,
  EXPLORE_USAGE_DOCS_PATH,
} from "../ui/sections/connect-your-agent-button";
import { PersonalOverviewScreen } from "../screens/personal-workspace/personal-overview.screen";
import {
  fakePersonalWorkspaceHost,
  renderWithPersonalWorkspaceHost,
  type FakePersonalWorkspaceHost,
} from "../testing";

let host: FakePersonalWorkspaceHost;

function renderPage() {
  host = fakePersonalWorkspaceHost();
  return renderWithPersonalWorkspaceHost(<PersonalOverviewScreen />, { host });
}

const connectButton = () => screen.queryByRole("button", { name: /connect your agent/i });

/** Renders the page and hands the menu trigger back for the test to assert on. */
function renderMenuTrigger() {
  const user = userEvent.setup();
  renderPage();
  return { user, trigger: connectButton() };
}

beforeEach(() => {
  vi.clearAllMocks();
  hasFirstMessageInputs.length = 0;
  hasFirstMessageRef.current = true;
});

// The file rendered the page in five cases and never took one down. It got
// away with it while every render threw on a stale fixture; with the page
// rendering, the second case finds two of everything.
afterEach(cleanup);

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

  // NOT tagged to "the menu offers Langy exploration, a coding-agent prompt,
  // and the guide": the menu offers two of the three now, and a tag on a test
  // that no longer proves its scenario is worse than an honest gap.
  it("offers the coding-agent prompt and the guide, and no Langy route", async () => {
    const { user, trigger } = renderMenuTrigger();
    expect(trigger).not.toBeNull();
    await user.click(trigger!);
    await screen.findByText("Explore via your coding agent");
    screen.getByText(/copy a prompt so claude code can inspect/i);
    const guide = screen.getByText("Read the guide");
    expect(guide.closest("a")?.getAttribute("href")).toContain(EXPLORE_USAGE_DOCS_PATH);
    expect(screen.queryByText("Explore via Langy")).toBeNull();
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

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(EXPLORE_USAGE_AGENT_PROMPT));
    await waitFor(() => expect(host.recording.successes.length).toBe(1));
    // The prompt must let a fresh coding-agent session self-inspect: the
    // CLI's device login carries the credentials, and the commands named
    // are the trace and spend reads.
    expect(EXPLORE_USAGE_AGENT_PROMPT).toMatch(/no API key/i);
    expect(EXPLORE_USAGE_AGENT_PROMPT).toMatch(/device login/i);
    expect(EXPLORE_USAGE_AGENT_PROMPT).toContain("langwatch trace search");
    expect(EXPLORE_USAGE_AGENT_PROMPT).toContain("langwatch analytics query -m total-cost");
  });
});

describe("the docs guide", () => {
  /** @scenario the docs guide carries the same coding-agent prompt the menu copies */
  it("contains the exact prompt the menu puts on the clipboard", () => {
    const docsFile = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../../..",
      "docs/coding-agents/explore-your-usage-with-your-own-agent.mdx",
    );
    const contents = readFileSync(docsFile, "utf-8");
    expect(contents).toContain(EXPLORE_USAGE_AGENT_PROMPT);
  });
});
