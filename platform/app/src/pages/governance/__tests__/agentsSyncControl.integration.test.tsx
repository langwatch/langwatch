/**
 * @vitest-environment jsdom
 *
 * The agents page's sync control, and the two empty states it changes.
 *
 * WHAT THIS FILE IS REALLY ABOUT is a control that cannot report its own
 * result. Pressing it records a request; a pipeline calls the provider later
 * and the answer reaches the page only through the next read. Every assertion
 * here is about the page saying what it STARTED and never what it found, and
 * about no unpressable state being silent about why.
 *
 * The other half is the empty table, and it now has FOUR readings rather than
 * two: no provider connected, none asked yet, every provider answered with
 * none, and a provider that refused. The last pair is what this file guards
 * hardest. A refusal and an empty tenant look identical on a page showing no
 * agents and demand opposite things of the reader — one means nothing is
 * wrong, the other means a credential is dead — so the assertions below are
 * written to fail if the two panes ever converge, not merely to check that
 * each exists.
 *
 * Only the boundaries are mocked: layout chrome, feature flag, toasts, and the
 * tRPC client.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  permissions: [] as string[],
  queryResults: {} as Record<string, Record<string, unknown>>,
  /** Every mutation the page fired, in order. */
  mutated: [] as { procedure: string; input: unknown }[],
  /** What the sync mutation reports back to the page's `onSuccess`. */
  requestListingResult: { requested: 0, sources: [] as unknown[] },
  toasts: [] as { title?: string; description?: string }[],
}));

const VIEWER = ["organization:view", "governance:view"];
const ADMIN = [...VIEWER, "governance:manage"];

vi.mock("~/hooks/useOrganizationTeamProject", async () => {
  const rbac =
    await vi.importActual<typeof import("~/server/api/rbac")>(
      "~/server/api/rbac",
    );
  const holds = (permission: string) =>
    rbac.hasPermissionWithHierarchy(harness.permissions, permission);
  return {
    useOrganizationTeamProject: () => ({
      isLoading: false,
      organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
      organizations: [],
      project: undefined,
      hasPermission: holds,
      hasOrgPermission: holds,
      hasAnyPermission: holds,
    }),
  };
});

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));

vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    pathname: "/governance/agents",
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: {
    create: (toast: { title?: string; description?: string }) => {
      harness.toasts.push(toast);
    },
  },
}));

vi.mock("~/utils/api", () => {
  const queryResult = () => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });

  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          const procedure = path.join(".");
          if (property === "useQuery") {
            return () => ({
              ...queryResult(),
              ...(harness.queryResults[procedure] ?? {}),
            });
          }
          if (property === "useMutation") {
            // Resolves synchronously into `onSuccess`, which is what makes the
            // "already asked" state reachable from a press in a test. The real
            // one resolves when the REQUEST is recorded, not when a provider
            // answers, so nothing is being short-circuited here.
            return (options?: { onSuccess?: (result: unknown) => void }) => ({
              mutate: (input: unknown) => {
                harness.mutated.push({ procedure, input });
                options?.onSuccess?.(harness.requestListingResult);
              },
              mutateAsync: vi.fn(),
              isPending: false,
              variables: undefined,
            });
          }
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );

  return { api: node([]) };
});

import { SAMPLE_CHOICE_KEY } from "~/components/governance/sample";

import AgentsPage from "../agents";

/**
 * `lastListing: null` is the deliberate default — no listing recorded — which
 * is the state every assertion written before the outcome read existed was
 * really describing. {@link listed} and {@link refused} move a fixture off it.
 */
const GENIE = {
  id: "src-genie",
  name: "Prod Genie",
  sourceType: "databricks_genie",
  lastListing: null as unknown,
};
const COPILOT = {
  id: "src-copilot",
  name: "Copilot tenant",
  sourceType: "copilot_studio_dataverse",
  lastListing: null as unknown,
};

/** A provider that answered. An empty list is still an answer. */
const listed = <T extends object>(source: T) => ({
  ...source,
  lastListing: { outcome: "listed" },
});

/** A provider that would not answer, and what a person does about it. */
const refused = <T extends object>(
  source: T,
  cause: "access" | "unreachable",
) => ({ ...source, lastListing: { outcome: "refused", cause } });

function renderAgents() {
  const router = createMemoryRouter(
    [{ path: "/governance/agents", Component: AgentsPage }],
    { initialEntries: ["/governance/agents"] },
  );
  render(
    <ChakraProvider value={defaultSystem}>
      <RouterProvider router={router} />
    </ChakraProvider>,
  );
}

const syncButton = () => screen.getByTestId("governance-sync-button");

beforeEach(() => {
  harness.permissions = ADMIN;
  harness.queryResults = { "governanceAgents.list": { data: [] } };
  harness.mutated = [];
  harness.requestListingResult = { requested: 0, sources: [] };
  harness.toasts = [];
  window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe("the agents sync control", () => {
  describe("given an administrator and a provider that can list agents", () => {
    beforeEach(() => {
      harness.queryResults["governanceAgents.syncSources"] = { data: [GENIE] };
    });

    /** @scenario "The sync control asks every provider that can list agents" */
    it("is pressable", () => {
      renderAgents();

      expect(syncButton()).toBeEnabled();
      expect(syncButton()).toHaveAttribute("data-state", "ready");
    });

    /** @scenario "The sync control asks every provider that can list agents" */
    it("asks for this organization when pressed", async () => {
      harness.requestListingResult = { requested: 1, sources: [GENIE] };
      renderAgents();

      await userEvent.click(syncButton());

      expect(harness.mutated).toEqual([
        {
          procedure: "governanceAgents.requestListing",
          input: { organizationId: "org-1" },
        },
      ]);
    });

    /**
     * The whole point of the control's wording. It reports the ask, names
     * reloading as how a result is seen, and says nothing about agents found —
     * because at this instant no provider has been called.
     */
    /** @scenario "The sync control reports what it started, not what it found" */
    it("says what was started and not what was found", async () => {
      harness.requestListingResult = {
        requested: 2,
        sources: [GENIE, COPILOT],
      };
      renderAgents();

      await userEvent.click(syncButton());

      expect(harness.toasts).toHaveLength(1);
      const [toast] = harness.toasts;
      expect(toast?.title).toBe("Sync requested");
      expect(toast?.description).toContain("Asked 2 providers");
      expect(toast?.description).toContain("Reload");
      expect(toast?.description).not.toMatch(/found|listed \d/i);
    });

    /**
     * A second request while one is in flight is dropped by the process
     * manager rather than queued, and this page cannot learn when the first
     * settled. So the control goes quiet and says why, instead of staying live
     * and doing nothing.
     */
    /** @scenario "A second press while a sync is in flight says so rather than doing nothing" */
    it("goes quiet with a reason once a request is recorded", async () => {
      harness.requestListingResult = { requested: 1, sources: [GENIE] };
      renderAgents();

      await userEvent.click(syncButton());

      expect(syncButton()).toBeDisabled();
      expect(syncButton()).toHaveAttribute("data-state", "asked");
      expect(syncButton().getAttribute("aria-label")).toContain(
        "Reload the page",
      );
    });

    /** @scenario "A second press while a sync is in flight says so rather than doing nothing" */
    it("dispatches nothing on a second press", async () => {
      harness.requestListingResult = { requested: 1, sources: [GENIE] };
      renderAgents();

      await userEvent.click(syncButton());
      await userEvent.click(syncButton());

      expect(harness.mutated).toHaveLength(1);
    });
  });

  describe("given an organization with no provider that can list agents", () => {
    /** @scenario "An organization with no listing provider is told so" */
    it("is disabled and says why", () => {
      harness.queryResults["governanceAgents.syncSources"] = { data: [] };
      renderAgents();

      expect(syncButton()).toBeDisabled();
      expect(syncButton().getAttribute("aria-label")).toContain(
        "No connected provider can list agents",
      );
    });
  });

  describe("given a reader without the manage grant", () => {
    /**
     * Drawn and disabled rather than absent, which is where this departs from
     * the people header's `Run match pass`. A reader who cannot press it is
     * the one least able to work out why the page will not refresh, and an
     * absent control tells them nothing at all.
     */
    /** @scenario "A reader who cannot sync is told why rather than shown nothing" */
    it("is disabled and names the grant rather than disappearing", () => {
      harness.permissions = VIEWER;
      harness.queryResults["governanceAgents.syncSources"] = { data: [GENIE] };
      renderAgents();

      expect(syncButton()).toBeDisabled();
      expect(syncButton().getAttribute("aria-label")).toContain(
        "Only an administrator",
      );
    });
  });
});

describe("the agents page's empty table", () => {
  describe("given a connected provider and no agents", () => {
    /**
     * It names the provider and offers the ask. What it must NOT do is claim
     * the tenant has no agents: a provider that refused to answer and one that
     * answered "none" are indistinguishable from here, and asserting the
     * absence of that claim is what keeps a later edit from adding it.
     */
    /** @scenario "An empty table with a provider connected says which and offers the ask" */
    it("names the provider without claiming the tenant is empty", () => {
      harness.queryResults["governanceAgents.syncSources"] = {
        data: [GENIE, COPILOT],
      };
      renderAgents();

      const empty = screen.getByTestId("agents-empty-unlisted");
      expect(empty).toBeVisible();
      expect(empty).toHaveTextContent("Prod Genie and Copilot tenant");
      expect(empty).toHaveTextContent("no agent has been listed from them");
      expect(screen.queryByTestId("agents-empty")).toBeNull();
    });

    /** @scenario "An empty table with a provider connected says which and offers the ask" */
    it("offers the sync rather than telling the reader to write registration code", () => {
      harness.queryResults["governanceAgents.syncSources"] = { data: [GENIE] };
      harness.requestListingResult = { requested: 1, sources: [GENIE] };
      renderAgents();

      const empty = screen.getByTestId("agents-empty-unlisted");
      expect(empty).toHaveTextContent("Sync agents");
      expect(empty).not.toHaveTextContent("No agents registered yet");
    });

    /**
     * Compared against the header's own control rather than against a named
     * variant, which is the form the rule is written in: an empty pane
     * repeating the header's action must look like the header's action,
     * whatever the section decides that looks like next. Both buttons are on
     * this one rendered page, so the reference cannot drift away from what a
     * reader actually sees.
     */
    /** @scenario "An empty pane's action is weighted by what it does" */
    it("draws the ask at the same weight the header draws it", () => {
      harness.queryResults["governanceAgents.syncSources"] = { data: [GENIE] };
      renderAgents();

      const inPane = within(
        screen.getByTestId("agents-empty-unlisted"),
      ).getByRole("button", { name: /Sync agents/ });

      // Self-check first: a className comparison that passed because one side
      // was empty would prove nothing.
      expect(syncButton().className).not.toBe("");
      expect(inPane.className).toBe(syncButton().className);
    });
  });

  describe("given a reader without the manage grant and a connected provider", () => {
    beforeEach(() => {
      harness.permissions = VIEWER;
      harness.queryResults["governanceAgents.syncSources"] = { data: [GENIE] };
    });

    /**
     * The control is drawn for this reader, disabled and carrying its own
     * reason, and that half was already right. The paragraph above it was not:
     * it ended "Ask now to find out what they hold" for everyone, which points
     * a reader at a press they cannot make.
     */
    /** @scenario "An empty pane explains itself rather than sitting blank" */
    it("names the grant instead of telling them to ask", () => {
      renderAgents();

      const empty = screen.getByTestId("agents-empty-unlisted");
      expect(empty).toHaveTextContent("Only an administrator can ask it");
      expect(empty).not.toHaveTextContent("Ask now");
    });

    /** @scenario "An empty pane explains itself rather than sitting blank" */
    it("still names the connected provider and claims nothing about the tenant", () => {
      renderAgents();

      const empty = screen.getByTestId("agents-empty-unlisted");
      expect(empty).toHaveTextContent("Prod Genie");
      expect(empty).toHaveTextContent("no agent has been listed from it");
    });
  });

  describe("given no connected provider and no agents", () => {
    /**
     * Registering really is the only move this reader has, so the older copy
     * is right here and only here.
     */
    /** @scenario "An organization with no listing provider is told so" */
    it("keeps the register-an-agent state", () => {
      harness.queryResults["governanceAgents.syncSources"] = { data: [] };
      renderAgents();

      expect(screen.getByTestId("agents-empty")).toBeVisible();
      expect(screen.queryByTestId("agents-empty-unlisted")).toBeNull();
    });
  });
});

/**
 * The distinction the whole listing outcome was built to carry, at the one
 * place a customer meets it.
 */
describe("the agents page's empty table, once a provider has answered", () => {
  const sourcesAre = (data: unknown[]) => {
    harness.queryResults["governanceAgents.syncSources"] = { data };
  };

  describe("given a provider that refused to list its agents", () => {
    /** @scenario "A provider that refused is never reported as an empty organization" */
    it("says the provider refused rather than that the organization is empty", () => {
      sourcesAre([refused(GENIE, "access")]);
      renderAgents();

      const empty = screen.getByTestId("agents-empty-refused");
      expect(empty).toBeVisible();
      expect(empty).toHaveTextContent("refused to answer");
      expect(empty).toHaveTextContent("cannot say what it holds");
      expect(empty).not.toHaveTextContent(/holds? no agents/);
      expect(empty).not.toHaveTextContent("No agents yet");
    });

    /**
     * THE ASSERTION THIS FILE EXISTS FOR. Both panes are rendered and their
     * words compared, because "a refusal pane exists" and "a refusal pane says
     * something different from the empty one" are not the same claim, and only
     * the second one is the feature. A later edit that pointed both branches
     * at one shared sentence would pass every other test here.
     *
     * The self-check comes first: comparing two empty strings would prove
     * nothing at all.
     */
    /** @scenario "A provider that refused is never reported as an empty organization" */
    it("says something different from the pane shown when a provider answered", () => {
      sourcesAre([refused(GENIE, "access")]);
      renderAgents();
      const refusedWords =
        screen.getByTestId("agents-empty-refused").textContent ?? "";
      cleanup();

      sourcesAre([listed(GENIE)]);
      renderAgents();
      const answeredWords =
        screen.getByTestId("agents-empty-listed").textContent ?? "";

      expect(refusedWords).not.toBe("");
      expect(answeredWords).not.toBe("");
      expect(refusedWords).not.toBe(answeredWords);
      // And not merely different by a word: the two make opposite claims.
      expect(answeredWords).toContain("no agents");
      expect(refusedWords).not.toContain("no agents");
    });

    /**
     * The status column is kept so an operator reading a support ticket can
     * tell a 403 from a 500. A tenant admin shown either learns nothing they
     * can act on, and the server never sends one.
     */
    /** @scenario "A refusal never shows the HTTP status behind it" */
    it("shows no status code and no provider error text", () => {
      sourcesAre([refused(GENIE, "access")]);
      renderAgents();

      const words =
        screen.getByTestId("agents-empty-refused").textContent ?? "";
      expect(words).not.toMatch(/\b[45]\d\d\b/);
      expect(words).not.toMatch(/unauthorized|not_configured|HTTP/i);
    });

    /** @scenario "A refusal names which providers refused and what to do about it" */
    it("names only the provider that refused", () => {
      sourcesAre([refused(GENIE, "access"), listed(COPILOT)]);
      renderAgents();

      const empty = screen.getByTestId("agents-empty-refused");
      expect(empty).toHaveTextContent("Prod Genie");
      // Naming the provider that answered would send its owner to audit a
      // credential that is working.
      expect(empty).not.toHaveTextContent("Copilot tenant");
    });

    /** @scenario "A refusal names which providers refused and what to do about it" */
    it("tells an administrator what to check", () => {
      sourcesAre([refused(GENIE, "access")]);
      renderAgents();

      expect(screen.getByTestId("agents-empty-refused")).toHaveTextContent(
        "Check that connection's credentials and permissions",
      );
    });

    /**
     * A rate limit is not a permission problem, and sending this reader to
     * audit one costs them an afternoon looking for a fault that is not there.
     */
    /** @scenario "A refusal that was only unreachable says to ask again" */
    it("says to ask again when the provider was merely unreachable", () => {
      sourcesAre([refused(GENIE, "unreachable")]);
      renderAgents();

      const empty = screen.getByTestId("agents-empty-refused");
      expect(empty).toHaveTextContent("did not answer");
      expect(empty).toHaveTextContent("Ask again in a moment");
      expect(empty).not.toHaveTextContent("credentials and permissions");
    });

    /**
     * A refusal beside a clean answer still wins the pane: agents behind the
     * refusing provider are missing from the list, so the quieter state would
     * be overclaiming.
     */
    /** @scenario "A refusal names which providers refused and what to do about it" */
    it("wins over a provider that answered cleanly", () => {
      sourcesAre([listed(COPILOT), refused(GENIE, "access")]);
      renderAgents();

      expect(screen.getByTestId("agents-empty-refused")).toBeVisible();
      expect(screen.queryByTestId("agents-empty-listed")).toBeNull();
    });
  });

  describe("given a reader without the manage grant and a refusal", () => {
    /** @scenario "A reader who cannot sync is told who can fix a refusal" */
    it("names who can fix it rather than telling them to press", () => {
      harness.permissions = VIEWER;
      sourcesAre([refused(GENIE, "access")]);
      renderAgents();

      const empty = screen.getByTestId("agents-empty-refused");
      expect(empty).toHaveTextContent(
        "An administrator needs to check that connection's",
      );
      expect(empty).not.toHaveTextContent("then ask again");
    });
  });

  describe("given every connected provider answered with no agents", () => {
    /**
     * The one branch on this page allowed to claim the organization has none,
     * and it may only because every provider that could hold agents was asked
     * and each returned an empty list.
     */
    /** @scenario "Every provider answering with none is the one time the page says so" */
    it("says the organization has none and offers registration", () => {
      sourcesAre([listed(GENIE), listed(COPILOT)]);
      renderAgents();

      const empty = screen.getByTestId("agents-empty-listed");
      expect(empty).toHaveTextContent("Prod Genie and Copilot tenant");
      expect(empty).toHaveTextContent("hold no agents");
      expect(empty).toHaveTextContent("Register agent");
    });
  });

  describe("given one provider answered and another was never asked", () => {
    /**
     * The unasked provider could be running a dozen, so the stronger claim is
     * not available and the page falls back to what it actually knows.
     */
    /** @scenario "A provider answered and another unasked claims nothing about the tenant" */
    it("keeps the weaker sentence rather than claiming the tenant is empty", () => {
      sourcesAre([listed(GENIE), COPILOT]);
      renderAgents();

      const empty = screen.getByTestId("agents-empty-unlisted");
      expect(empty).toHaveTextContent("no agent has been listed from them");
      expect(empty).not.toHaveTextContent("hold no agents");
      expect(screen.queryByTestId("agents-empty-listed")).toBeNull();
    });
  });
});
