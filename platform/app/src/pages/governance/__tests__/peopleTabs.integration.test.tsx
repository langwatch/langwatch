/**
 * @vitest-environment jsdom
 *
 * The People page: one table of everyone, two tabs, and the section's shared
 * controls. The selected tab, the time frame, the department and the sort are
 * all part of the address, so every test mounts the real page in a memory
 * router and asserts against the same address the user sees.
 *
 * Only the boundaries are mocked - layout chrome, the feature flag, the plan,
 * the compat router, and the tRPC client, which answers per procedure from the
 * harness and records what each read was asked for. The permission decision is
 * the real one: `hasAnyPermission` runs the same `hasPermissionWithHierarchy`
 * the server uses.
 *
 * Spec: specs/ai-governance/dashboard/people-tabs.feature
 * Spec: specs/ai-governance/dashboard/governance-ui-controls.feature
 */
import { Button, ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { findNativeSelects } from "~/components/governance/filters";

type QueryAnswer = {
  data?: unknown;
  error?: unknown;
  isLoading?: boolean;
};

const harness = vi.hoisted(() => ({
  /** The grants the viewer under test holds. */
  permissions: [] as string[],
  /** Whether the organization's plan includes the activity monitor. */
  isEnterprise: true,
  /** Every procedure path whose `useQuery` was NOT disabled. */
  requested: [] as string[],
  /** What each of those reads was asked for. */
  inputs: {} as Record<string, unknown>,
  /** What each procedure answers; anything unlisted answers `undefined`. */
  answers: {} as Record<string, QueryAnswer>,
  /** Every mutation call, so a header action can be proven to reach one. */
  mutations: [] as Array<{ path: string; input: unknown }>,
}));

/** The org-member floor, the governance product grant, and the spend read. */
const VIEWER_PERMISSIONS = [
  "organization:view",
  "governance:view",
  "activityMonitor:view",
  "ingestionSources:view",
];

const MANAGER_PERMISSIONS = [...VIEWER_PERMISSIONS, "governance:manage"];

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

vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({
    isEnterprise: harness.isEnterprise,
    isLoading: false,
    activePlan: undefined,
  }),
}));

vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    pathname: "/governance/people",
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("~/utils/api", () => {
  const queryResult = (answer: QueryAnswer | undefined) => ({
    data: answer?.data,
    isLoading: answer?.isLoading ?? false,
    isFetching: false,
    isError: !!answer?.error,
    error: answer?.error ?? null,
    refetch: vi.fn(),
  });

  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            return (input: unknown, options?: { enabled?: boolean }) => {
              const key = path.join(".");
              if (options?.enabled !== false) {
                harness.requested.push(key);
                harness.inputs[key] = input;
              }
              return queryResult(harness.answers[key]);
            };
          }
          if (property === "useMutation") {
            return () => {
              const key = path.join(".");
              return {
                mutate: (input: unknown) =>
                  harness.mutations.push({ path: key, input }),
                mutateAsync: vi.fn(),
                isPending: false,
                variables: undefined,
              };
            };
          }
          if (property === "invalidate") return vi.fn();
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );

  return { api: node([]) };
});

import { SAMPLE_CHOICE_KEY } from "~/components/governance/sample";

import PeoplePage from "../people";

const THREE_DAYS_AGO = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

const JANE = {
  actor: "jane.doe@example.com",
  spendUsd: "12.5",
  requests: 1234,
  lastActivityIso: THREE_DAYS_AGO.toISOString(),
  trendVsPreviousPct: 0,
  hasPriorBaseline: false,
  mostUsedTarget: "claude-fable-5-1",
};

const SAM = {
  actor: "sam@example.com",
  spendUsd: "3",
  requests: 7,
  lastActivityIso: THREE_DAYS_AGO.toISOString(),
  trendVsPreviousPct: 0,
  hasPriorBaseline: false,
  mostUsedTarget: "Cursor",
};

const seenAt = new Date("2026-08-01T00:00:00.000Z");

const discovered = (over: Record<string, unknown>) => ({
  id: `person_${String(over.displayText ?? over.rawActorId ?? "x")}`,
  provider: "copilot_studio_dataverse",
  kind: "person",
  displayText: "Someone",
  rawActorId: "someone",
  directoryDepartment: null,
  firstSeenAt: seenAt,
  lastSeenAt: seenAt,
  erasedAt: null,
  suspendedAt: null,
  suspendedReason: null,
  link: null,
  ...over,
});

function renderPeopleAt(initialEntries: string[]) {
  const router = createMemoryRouter(
    [{ path: "/governance/people", Component: PeoplePage }],
    { initialEntries },
  );
  render(
    <ChakraProvider value={defaultSystem}>
      <RouterProvider router={router} />
    </ChakraProvider>,
  );
  return router;
}

/** Every read answered, none of them holding a row: the sample default's case. */
const answerEverythingEmpty = () => {
  harness.answers["activityMonitor.spendByUser"] = { data: [] };
  harness.answers["governancePeople.list"] = { data: [] };
  harness.answers["departments.list"] = { data: [] };
};

beforeEach(() => {
  // The section keeps ONE sample choice for the whole sitting, in session
  // storage, so a test that presses the toggle would otherwise hand its
  // answer to the next one.
  window.sessionStorage.clear();
  harness.permissions = VIEWER_PERMISSIONS;
  harness.isEnterprise = true;
  harness.requested = [];
  harness.inputs = {};
  harness.answers = {};
  harness.mutations = [];
  window.sessionStorage.clear();
});

afterEach(() => cleanup());

describe("the People page tab shell", () => {
  describe("when a viewer opens the bare address", () => {
    /** @scenario "The default tab is People" */
    it("selects People, requests the table, and writes no tab parameter", () => {
      const router = renderPeopleAt(["/governance/people"]);

      expect(screen.getByRole("tab", { name: "People" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(harness.requested).toContain("activityMonitor.spendByUser");
      expect(router.state.location.search).not.toContain("tab");
    });
  });

  describe("when the address names the departments tab", () => {
    /** @scenario "The Departments tab is addressable" */
    it("selects Departments and requests the department list", () => {
      renderPeopleAt(["/governance/people?tab=departments"]);

      expect(screen.getByRole("tab", { name: "Departments" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(harness.requested).toContain("departments.list");
    });
  });
});

describe("the one people table", () => {
  describe("when one person used AI through a connected source", () => {
    /** @scenario "The People table renders each person with spend, requests and last activity" */
    it("lists them with spend, requests, last activity and a link to their page", () => {
      harness.answers["activityMonitor.spendByUser"] = { data: [JANE] };
      renderPeopleAt(["/governance/people"]);

      const row = screen.getByRole("row", { name: /jane\.doe/ });
      expect(within(row).getByText("jane.doe")).toBeInTheDocument();
      expect(within(row).getByText("jane.doe@example.com")).toBeInTheDocument();
      expect(within(row).getByText("$12.50")).toBeInTheDocument();
      expect(within(row).getByText("1,234")).toBeInTheDocument();
      expect(within(row).getByText("3 days ago")).toBeInTheDocument();
      expect(
        within(row).getByRole("link", { name: "jane.doe" }),
      ).toHaveAttribute("href", "/governance/users/jane.doe%40example.com");
    });
  });

  describe("when a person matches an organization member with a department", () => {
    /** @scenario "A person matching an organization member shows that member's department" */
    it("shows the member's department, and a dash for everyone else", () => {
      harness.answers["activityMonitor.spendByUser"] = { data: [JANE, SAM] };
      harness.answers["departments.list"] = {
        data: [{ id: "dept-1", name: "Engineering" }],
      };
      harness.answers["departments.assignments"] = {
        data: {
          users: [
            {
              id: "user-1",
              name: "Jane Doe",
              email: "jane.doe@example.com",
              departmentId: "dept-1",
            },
          ],
          teams: [],
          projects: [],
        },
      };
      renderPeopleAt(["/governance/people"]);

      const jane = screen.getByRole("row", { name: /jane\.doe/ });
      expect(within(jane).getByText("Engineering")).toBeInTheDocument();
      const sam = screen.getByRole("row", { name: /sam@/ });
      expect(within(sam).queryByText("Engineering")).not.toBeInTheDocument();
      expect(within(sam).getAllByText("—").length).toBeGreaterThan(0);
    });
  });

  describe("when a most-used target names a connected source", () => {
    /** @scenario "A most-used chip links to its source only when a source matches" */
    it("links the matching chip to the source and leaves the other plain", () => {
      harness.answers["activityMonitor.spendByUser"] = { data: [JANE, SAM] };
      harness.answers["ingestionSources.list"] = {
        data: [{ id: "src-1", name: "Cursor", sourceType: "cursor" }],
      };
      renderPeopleAt(["/governance/people"]);

      const sam = screen.getByRole("row", { name: /sam@/ });
      expect(within(sam).getByRole("link", { name: "Cursor" })).toHaveAttribute(
        "href",
        "/governance/inventory/src-1",
      );
      const jane = screen.getByRole("row", { name: /jane\.doe/ });
      expect(within(jane).getByText("claude-fable-5-1")).toBeInTheDocument();
      expect(
        within(jane).queryByRole("link", { name: "claude-fable-5-1" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when a provider named somebody nothing metered", () => {
    /** @scenario "A person the providers named with no spend behind them is on the same table" */
    it("puts them on the same table, with no spend and no request count", () => {
      harness.answers["activityMonitor.spendByUser"] = { data: [JANE] };
      harness.answers["governancePeople.list"] = {
        data: [
          discovered({ displayText: "Maria Silva", rawActorId: "maria@x.com" }),
        ],
      };
      renderPeopleAt(["/governance/people"]);

      const rows = screen.getAllByRole("row");
      // One header row plus both people, on one table.
      expect(rows).toHaveLength(3);
      const maria = screen.getByRole("row", { name: /Maria Silva/ });
      expect(within(maria).getAllByLabelText("not measured")).toHaveLength(2);
    });
  });

  describe("when a spend row and one discovered person name the same address", () => {
    /** @scenario "A spend row and the discovered person naming the same identifier are one row" */
    it("renders one row carrying both the money and the provider", () => {
      harness.answers["activityMonitor.spendByUser"] = { data: [JANE] };
      harness.answers["governancePeople.list"] = {
        data: [
          discovered({
            displayText: "Jane Doe",
            rawActorId: "jane.doe@example.com",
          }),
        ],
      };
      renderPeopleAt(["/governance/people"]);

      expect(screen.getAllByRole("row")).toHaveLength(2);
      const row = screen.getByRole("row", { name: /Jane Doe/ });
      expect(within(row).getByText("$12.50")).toBeInTheDocument();
      expect(within(row).getByText(/Seen at/)).toBeInTheDocument();
    });
  });

  describe("when the table holds a linked, an unlinked and an erased person", () => {
    /** @scenario "Every row says whether we know the account behind it" */
    it("marks each row matched, unmatched or erased", () => {
      harness.answers["governancePeople.list"] = {
        data: [
          discovered({
            displayText: "Linked Person",
            rawActorId: "linked@x.com",
            link: {
              userId: "user-1",
              evidenceKind: "verified_email",
              memberName: "Linked Person",
              departmentName: null,
            },
          }),
          discovered({
            displayText: "Unlinked Person",
            rawActorId: "unlinked@x.com",
          }),
          discovered({
            displayText: "person_7f31c2",
            rawActorId: "person_7f31c2",
            erasedAt: seenAt,
          }),
        ],
      };
      renderPeopleAt(["/governance/people"]);

      expect(
        within(screen.getByRole("row", { name: /Linked Person/ })).getByText(
          "Matched",
        ),
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole("row", { name: /Unlinked Person/ })).getByText(
          "Unmatched",
        ),
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole("row", { name: /person_7f31c2/ })).getByText(
          "Erased",
        ),
      ).toBeInTheDocument();
    });
  });
});

describe("the filter row", () => {
  describe("when the page renders", () => {
    /** @scenario "Time frame, department and sort are chips in one row under the header" */
    it("holds the time frame, the department and the sort, and no native select", () => {
      harness.answers["activityMonitor.spendByUser"] = { data: [JANE] };
      const { container } = render(
        <ChakraProvider value={defaultSystem}>
          <RouterProvider
            router={createMemoryRouter(
              [{ path: "/governance/people", Component: PeoplePage }],
              { initialEntries: ["/governance/people"] },
            )}
          />
        </ChakraProvider>,
      );

      const row = screen.getByTestId("people-filter-row");
      expect(within(row).getByText("Time frame")).toBeInTheDocument();
      expect(within(row).getByText("Department")).toBeInTheDocument();
      expect(within(row).getByText("Sort")).toBeInTheDocument();
      // Nothing that changes the table lives anywhere else on the page.
      expect(screen.getAllByText("Sort")).toHaveLength(1);
      expect(findNativeSelects(container)).toHaveLength(0);
    });
  });

  describe("when the page renders with data and again with none", () => {
    /** @scenario "No governance page renders a native select" */
    it("contains no native select element either way", () => {
      harness.answers["activityMonitor.spendByUser"] = { data: [JANE] };
      const withData = renderPeopleAt(["/governance/people"]);
      expect(findNativeSelects(document.body)).toHaveLength(0);
      expect(withData.state.location.pathname).toBe("/governance/people");
      cleanup();

      answerEverythingEmpty();
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
      renderPeopleAt(["/governance/people"]);
      expect(findNativeSelects(document.body)).toHaveLength(0);
    });
  });

  describe("when the address already names a frame, a department and a sort", () => {
    /** @scenario "The chosen time frame, department and sort are part of the address" */
    it("reads all three back from the address", () => {
      harness.answers["activityMonitor.spendByUser"] = { data: [JANE, SAM] };
      harness.answers["departments.list"] = {
        data: [{ id: "dept-1", name: "Engineering" }],
      };
      harness.answers["departments.assignments"] = {
        data: {
          users: [
            {
              id: "user-1",
              name: "Jane Doe",
              email: "jane.doe@example.com",
              departmentId: "dept-1",
            },
          ],
          teams: [],
          projects: [],
        },
      };
      renderPeopleAt([
        "/governance/people?frame=last_3_months&department=Engineering&sort=requests",
      ]);

      const row = screen.getByTestId("people-filter-row");
      expect(within(row).getByText("Last 3 months")).toBeInTheDocument();
      expect(within(row).getByText("Engineering")).toBeInTheDocument();
      expect(within(row).getByText("Requests")).toBeInTheDocument();
      expect(harness.inputs["activityMonitor.spendByUser"]).toMatchObject({
        windowDays: 90,
        sortBy: "requests",
      });
    });
  });

  describe("when the reader picks a frame from the chip", () => {
    it("writes the choice to the address", async () => {
      harness.answers["activityMonitor.spendByUser"] = { data: [JANE] };
      const router = renderPeopleAt(["/governance/people"]);

      await userEvent.click(screen.getByRole("button", { name: /Time frame/ }));
      await userEvent.click(await screen.findByText("Last 3 months"));

      await waitFor(() =>
        expect(router.state.location.search).toContain("frame=last_3_months"),
      );
    });
  });

  describe("when the reader picks the longest frame", () => {
    /** @scenario "A time frame longer than the spend read accepts is asked for at the read's limit" */
    it("asks the spend read for the longest window it accepts", () => {
      harness.answers["activityMonitor.spendByUser"] = { data: [JANE] };
      renderPeopleAt(["/governance/people?frame=last_2_years"]);

      expect(harness.inputs["activityMonitor.spendByUser"]).toMatchObject({
        windowDays: 365,
      });
      expect(
        screen.getByText(/longest window this read answers/),
      ).toBeInTheDocument();
    });
  });

  describe("when a department is chosen", () => {
    /** @scenario "The department chip filters the table to that department" */
    it("lists only that department's people", () => {
      harness.answers["activityMonitor.spendByUser"] = { data: [JANE, SAM] };
      harness.answers["departments.list"] = {
        data: [{ id: "dept-1", name: "Engineering" }],
      };
      harness.answers["departments.assignments"] = {
        data: {
          users: [
            {
              id: "user-1",
              name: "Jane Doe",
              email: "jane.doe@example.com",
              departmentId: "dept-1",
            },
          ],
          teams: [],
          projects: [],
        },
      };
      renderPeopleAt(["/governance/people?department=Engineering"]);

      expect(
        screen.getByRole("row", { name: /jane\.doe/ }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("row", { name: /sam@/ }),
      ).not.toBeInTheDocument();
    });
  });
});

/**
 * Chakra emits one hashed class per element, so a button's size and variant are
 * not readable off the DOM - but two buttons built the same way get the SAME
 * hash. Rendering references beside the page is therefore a real assertion
 * about how the header's actions were built, not a proxy for one.
 */
function ButtonReferences() {
  return (
    <>
      <Button size="sm" variant="outline">
        reference outline small
      </Button>
      <Button size="sm" variant="ghost">
        reference ghost small
      </Button>
      {/* Solid in the section's own colour, which is what Inventory's Add tool
          renders and what a create action here has to match. A plain solid
          button is grey, and comparing against that would let the page drift
          away from the rest of the section while still passing. */}
      <Button size="sm" colorPalette="orange">
        reference solid small
      </Button>
    </>
  );
}

const renderPeopleWithReferences = (entry: string) => {
  const router = createMemoryRouter(
    [
      {
        path: "/governance/people",
        element: (
          <>
            <PeoplePage />
            <ButtonReferences />
          </>
        ),
      },
    ],
    { initialEntries: [entry] },
  );
  return render(
    <ChakraProvider value={defaultSystem}>
      <RouterProvider router={router} />
    </ChakraProvider>,
  );
};

describe("the page header", () => {
  describe("when a manager opens the page", () => {
    /** @scenario "The page's actions sit top-right in the header" */
    it("puts the sample toggle, Run match pass and Add department in the header", () => {
      harness.permissions = MANAGER_PERMISSIONS;
      renderPeopleAt(["/governance/people"]);

      const header = screen.getByTestId("people-page-header");
      expect(
        within(header).getByRole("button", { name: /sample data/i }),
      ).toBeInTheDocument();
      expect(
        within(header).getByRole("button", { name: "Run match pass" }),
      ).toBeInTheDocument();
      expect(
        within(header).getByRole("button", { name: /Add department/ }),
      ).toBeInTheDocument();
    });

    /** @scenario "Primary page actions sit top-right in the page header" */
    it("renders them small, with only the create action solid", () => {
      harness.permissions = MANAGER_PERMISSIONS;
      renderPeopleWithReferences("/governance/people");

      const header = screen.getByTestId("people-page-header");
      const outlineSmall = screen.getByText(
        "reference outline small",
      ).className;
      const ghostSmall = screen.getByText("reference ghost small").className;
      const solidSmall = screen.getByText("reference solid small").className;

      const actions = within(header).getAllByRole("button");
      expect(actions).toHaveLength(3);
      // Exactly one, not "at most one": a header where nothing is solid reads
      // as a header with no primary action, which is the drift this rule
      // exists to catch.
      expect(
        actions.filter((action) => action.className === solidSmall),
      ).toHaveLength(1);
      // Adding a department is the only action here that creates something of
      // the organization's own, so it is the solid one.
      expect(
        within(header).getByRole("button", { name: /Add department/ })
          .className,
      ).toBe(solidSmall);
      expect(
        within(header).getByRole("button", { name: "Run match pass" })
          .className,
      ).toBe(outlineSmall);
      // Ghost rather than outline, because it changes what the page shows
      // rather than anything about the organization.
      expect(
        within(header).getByRole("button", { name: /See sample data/ })
          .className,
      ).toBe(ghostSmall);
    });

    /** @scenario "Run match pass is a header action, not a panel's own button" */
    it("runs the proof pass from the header action", async () => {
      harness.permissions = MANAGER_PERMISSIONS;
      renderPeopleAt(["/governance/people"]);

      await userEvent.click(
        screen.getByRole("button", { name: "Run match pass" }),
      );

      expect(harness.mutations).toContainEqual({
        path: "governancePeople.runMatch",
        input: { organizationId: "org-1" },
      });
    });
  });

  describe("when a viewer without the manage grant opens the page", () => {
    it("offers no write actions but keeps the sample toggle", () => {
      renderPeopleAt(["/governance/people"]);

      const header = screen.getByTestId("people-page-header");
      expect(
        within(header).getByRole("button", { name: /sample data/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Run match pass" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Add department/ }),
      ).not.toBeInTheDocument();
    });
  });
});

describe("sample data", () => {
  describe("when every read has answered and none holds a row", () => {
    /** @scenario "A page with nobody on it opens on sample people" */
    it("fills the table with sample people under a banner", () => {
      answerEverythingEmpty();
      renderPeopleAt(["/governance/people"]);

      expect(screen.getByRole("status")).toHaveTextContent(
        /nothing here is real/,
      );
      expect(screen.getByText("Avery Nakamura")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Hide sample data/ }),
      ).toBeInTheDocument();
    });

    /** @scenario "Turning sample data off on an empty page says nobody was active" */
    it("says nobody was active once the reader turns the samples off", async () => {
      answerEverythingEmpty();
      renderPeopleAt(["/governance/people"]);

      await userEvent.click(
        screen.getByRole("button", { name: /Hide sample data/ }),
      );

      expect(
        await screen.findByText(
          "No one has used AI through a connected source in the last 12 months.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  describe("when the page has real people on it", () => {
    /** @scenario "Sample data steps aside once real people arrive" */
    it("keeps the sample people off screen and still offers them", () => {
      harness.answers["activityMonitor.spendByUser"] = { data: [JANE] };
      harness.answers["governancePeople.list"] = { data: [] };
      harness.answers["departments.list"] = { data: [] };
      renderPeopleAt(["/governance/people"]);

      expect(screen.queryByText("Avery Nakamura")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /See sample data/ }),
      ).toBeInTheDocument();
    });
  });

  describe("when the organization's plan does not include the activity monitor", () => {
    /** @scenario "Enterprise-locked activity shows a quiet line, not an alert" */
    it("shows a muted locked line and no alert", () => {
      harness.isEnterprise = false;
      renderPeopleAt(["/governance/people"]);

      const note = screen.getByRole("note");
      expect(note).toHaveTextContent(/Enterprise plan/);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText(/Couldn't load/)).not.toBeInTheDocument();
    });

    /** @scenario "Sample mode shows no error alerts, not even the plan refusal" */
    it("suppresses the locked line and every alert while sample data is on", async () => {
      harness.isEnterprise = false;
      harness.answers["governancePeople.list"] = {
        error: {
          error: { code: "internal_error", message: "internal_error" },
        },
      };
      renderPeopleAt(["/governance/people"]);

      await userEvent.click(
        screen.getByRole("button", { name: /See sample data/ }),
      );

      await waitFor(() =>
        expect(screen.getByText("Avery Nakamura")).toBeInTheDocument(),
      );
      expect(screen.queryByRole("note")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("when nobody was active and the reader has turned samples off", () => {
    /** @scenario "Nobody active in the window" */
    it("says so in the People tab", async () => {
      answerEverythingEmpty();
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
      renderPeopleAt(["/governance/people"]);

      expect(
        await screen.findByText(
          "No one has used AI through a connected source in the last 12 months.",
        ),
      ).toBeInTheDocument();
    });
  });
});

describe("the Departments tab", () => {
  describe("when a manager adds a department", () => {
    /** @scenario "Adding a department is a dialog, not a box wedged into the header" */
    it("opens a dialog with a named field and a primary Create", async () => {
      harness.permissions = MANAGER_PERMISSIONS;
      harness.answers["departments.list"] = { data: [] };
      renderPeopleAt(["/governance/people?tab=departments"]);

      await userEvent.click(
        screen.getByRole("button", { name: /Add department/ }),
      );

      const dialog = await screen.findByRole("dialog");
      const field = within(dialog).getByRole("textbox", {
        name: "Department name",
      });
      // Click before typing: the dialog moves focus to itself as it opens, and
      // typing into a field that has not been focused yet drops the keystrokes.
      await userEvent.click(field);
      await waitFor(() => expect(field).toHaveFocus());
      await userEvent.type(field, "Engineering");
      await waitFor(() => expect(field).toHaveValue("Engineering"));
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Create" }),
      );

      expect(harness.mutations).toContainEqual({
        path: "departments.create",
        input: { organizationId: "org-1", name: "Engineering" },
      });
    });
  });

  describe("when a viewer without the manage grant opens it", () => {
    /** @scenario "The Departments tab offers no controls to a viewer without the manage grant" */
    it("offers no create control and names the grant", () => {
      harness.answers["departments.list"] = {
        data: [{ id: "dept-1", name: "Engineering" }],
      };
      renderPeopleAt(["/governance/people?tab=departments"]);

      expect(
        screen.queryByRole("button", { name: /Add department/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Actions for/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("Engineering")).toBeInTheDocument();
      expect(screen.getByText(/governance:manage/)).toBeInTheDocument();
    });
  });
});

describe("assigning a department from a row", () => {
  describe("when a manager opens the row action on a person we know the account for", () => {
    /** @scenario "Assigning a department to a person uses the app's own select" */
    /** @scenario "A choice too long for a pill uses the app's own select" */
    it("offers the app's own select, never a native one", async () => {
      harness.permissions = MANAGER_PERMISSIONS;
      harness.answers["governancePeople.list"] = {
        data: [
          discovered({
            displayText: "Linked Person",
            rawActorId: "linked@x.com",
            link: {
              userId: "user-1",
              evidenceKind: "verified_email",
              memberName: "Linked Person",
              departmentName: null,
            },
          }),
        ],
      };
      harness.answers["departments.list"] = {
        data: [
          { id: "dept-1", name: "Engineering" },
          { id: "dept-2", name: "Finance" },
        ],
      };
      const { container } = render(
        <ChakraProvider value={defaultSystem}>
          <RouterProvider
            router={createMemoryRouter(
              [{ path: "/governance/people", Component: PeoplePage }],
              { initialEntries: ["/governance/people"] },
            )}
          />
        </ChakraProvider>,
      );

      await userEvent.click(
        screen.getByRole("button", { name: "Actions for Linked Person" }),
      );
      await userEvent.click(await screen.findByText("Assign department"));

      expect(
        await screen.findByRole("combobox", { name: "Department" }),
      ).toBeInTheDocument();
      // The dialog portals out of the page container, so the whole document is
      // the honest place to look. `findNativeSelects` skips the aria-hidden
      // select Ark ships for autofill, which no reader can reach.
      expect(findNativeSelects(container)).toHaveLength(0);
      expect(findNativeSelects(document.body)).toHaveLength(0);
    });
  });
});
