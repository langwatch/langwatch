/**
 * @vitest-environment jsdom
 *
 * The privacy rule drawer lives in the page URL.
 *
 * `platform/app/src/pages/settings/__tests__/dataPrivacyDrawerUrl.integration.test.tsx`,
 * moved with the page. What changed is WHICH address carries the drawer, and
 * only that: it was the application's drawer registry
 * (`?drawer.open=dataPrivacyRule&drawer.editScopeType=…`) and it is now the
 * screen's own key (`?rule=…`), because this page was the registry entry's only
 * opener. The spec asks that the URL carry the drawer and the rule it targets,
 * that a pasted link reopen the same rule, and that closing clear it — all four
 * still hold, which is why the four `@scenario` annotations travel unchanged.
 *
 * Spec: specs/data-privacy/privacy-rule-drawer-url.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DataPrivacyHostPort,
  DataPrivacyHostProvider,
  type PrivacyFailureNotice,
  type PrivacyHostScope,
  type PrivacyRouteReading,
  type PrivacySuccessNotice,
} from "../../../model/data-privacy-host";
import DataPrivacyScreen from "../data-privacy.screen";

const { snapshot, invalidate, removeForScope, setForScope } = vi.hoisted(() => {
  const category = { disposition: "capture" as const, audience: {} };
  const baseline = {
    categories: {
      input: category,
      output: category,
      system: category,
      tools: category,
    },
    pii: { level: "essential" as const, entities: [], exceptPatterns: [] },
    secrets: { enabled: true, customPatterns: [] },
    customAttributes: [],
  };
  return {
    invalidate: vi.fn(async () => undefined),
    removeForScope: vi.fn(async () => undefined),
    setForScope: vi.fn(async () => undefined),
    snapshot: {
      projectId: "proj-1",
      available: {
        organization: { id: "org-1", name: "Acme" },
        departments: [],
        teams: [{ id: "team-1", name: "Platform" }],
        projects: [{ id: "proj-1", name: "Web App", teamId: "team-1" }],
      },
      audienceOptions: { groups: [] },
      effective: baseline,
      effectiveTeam: baseline,
      effectiveOrganization: baseline,
      rules: [
        {
          scopeType: "TEAM" as const,
          scopeId: "team-1",
          name: "Platform",
          personalOnly: false,
          config: { categories: { input: { disposition: "drop" as const } } },
        },
      ],
    },
  };
});

vi.mock("../../../behavior/data-privacy-api", () => ({
  dataPrivacyApi: {
    useUtils: () => ({ dataPrivacy: { getSnapshot: { invalidate } } }),
    dataPrivacy: {
      getSnapshot: { useQuery: () => ({ data: snapshot, isLoading: false }) },
      removeForScope: {
        useMutation: () => ({ mutateAsync: removeForScope, isPending: false }),
      },
      setForScope: {
        useMutation: () => ({ mutateAsync: setForScope, isPending: false }),
      },
    },
  },
}));

class TestPrivacyHost extends DataPrivacyHostPort {
  readonly writes: Array<Readonly<Record<string, string | undefined>>> = [];
  readonly successes: PrivacySuccessNotice[] = [];
  readonly failures: PrivacyFailureNotice[] = [];

  constructor(private query: Readonly<Record<string, string | undefined>> = {}) {
    super();
  }

  scope(): PrivacyHostScope {
    return { organizationId: "org-1", teamId: "team-1", projectId: "proj-1" };
  }

  route(): PrivacyRouteReading {
    return { params: {}, query: this.query };
  }

  setQuery(next: Readonly<Record<string, string | undefined>>): void {
    this.writes.push(next);
    this.query = next;
  }

  succeeded(notice: PrivacySuccessNotice): void {
    this.successes.push(notice);
  }

  failed(failure: PrivacyFailureNotice): void {
    this.failures.push(failure);
  }
}

function renderScreen(host: TestPrivacyHost) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DataPrivacyHostProvider value={host}>
        <DataPrivacyScreen />
      </DataPrivacyHostProvider>
    </ChakraProvider>,
  );
}

describe("given the data privacy page", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("when an admin opens the add flow", () => {
    /** @scenario Opening the add flow reflects in the URL */
    it("writes the drawer into the address with no rule targeted", async () => {
      const user = userEvent.setup();
      const host = new TestPrivacyHost();
      renderScreen(host);

      await user.click(screen.getByRole("button", { name: "Add privacy rule" }));

      expect(host.writes.at(-1)).toEqual({ rule: "new" });
    });
  });

  describe("when an admin opens a rule to edit", () => {
    /** @scenario Opening a rule to edit reflects in the URL */
    it("writes the rule's own scope into the address", async () => {
      const user = userEvent.setup();
      const host = new TestPrivacyHost();
      renderScreen(host);

      await user.click(screen.getByRole("button", { name: "Actions for Platform privacy rule" }));
      await user.click(await screen.findByRole("menuitem", { name: "Edit" }));

      expect(host.writes.at(-1)).toEqual({ rule: "TEAM:team-1:false" });
    });
  });

  describe("when a shared link carries the drawer for a team scope", () => {
    /** @scenario A shared link reopens the same rule */
    it("rebuilds the drawer showing that team rule from the address alone", async () => {
      renderScreen(new TestPrivacyHost({ rule: "TEAM:team-1:false" }));

      expect(await screen.findByText("Edit privacy rule")).toBeInTheDocument();
      expect(screen.getByLabelText("Input").textContent).toContain("Dropped");
    });
  });

  describe("when the admin closes the drawer", () => {
    /** @scenario Closing the drawer clears it from the URL */
    it("clears the rule from the address", async () => {
      const user = userEvent.setup();
      const host = new TestPrivacyHost({ rule: "TEAM:team-1:false" });
      renderScreen(host);

      // The drawer portals its content, and Ark attaches the Escape listener
      // only once that content is mounted. Wait for it, or the keypress lands
      // before the listener exists.
      await screen.findByText("Edit privacy rule");

      await user.keyboard("{Escape}");

      await waitFor(() => expect(host.writes.at(-1)).toEqual({ rule: void 0 }));
    });
  });

  describe("when a rule is deleted", () => {
    it("tells the reader it is gone and refreshes the list", async () => {
      const user = userEvent.setup();
      const host = new TestPrivacyHost();
      renderScreen(host);

      await user.click(screen.getByRole("button", { name: "Actions for Platform privacy rule" }));
      await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

      await waitFor(() => expect(removeForScope).toHaveBeenCalled());
      expect(host.successes.at(-1)?.title).toBe("Privacy rule removed");
      expect(invalidate).toHaveBeenCalled();
    });
  });

  describe("when removing a rule fails", () => {
    it("hands the raw error to the host rather than composing copy for it", async () => {
      const user = userEvent.setup();
      const boom = new Error("nope");
      removeForScope.mockRejectedValueOnce(boom);
      const host = new TestPrivacyHost();
      renderScreen(host);

      await user.click(screen.getByRole("button", { name: "Actions for Platform privacy rule" }));
      await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

      await waitFor(() => expect(host.failures).toHaveLength(1));
      expect(host.failures[0]).toEqual({
        error: boom,
        fallbackTitle: "Couldn't remove this rule",
      });
    });
  });
});
