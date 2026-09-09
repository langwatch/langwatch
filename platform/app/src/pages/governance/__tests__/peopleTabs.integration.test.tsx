/**
 * @vitest-environment jsdom
 *
 * The People page: one table of everyone, two tabs, and the section's shared
 * controls. The selected tab, the department and the sort are all part of the
 * address, so every test mounts the real page in a memory router and asserts
 * against the same address the user sees.
 *
 * Only the boundaries are mocked - layout chrome, the feature flag, the plan,
 * the compat router, the drawer navigation, and the tRPC client, which answers
 * per procedure from the harness and records what each read was asked for. The
 * permission decision is the real one: `hasAnyPermission` runs the same
 * `hasPermissionWithHierarchy` the server uses.
 *
 * The create-department drawer is mounted by `CurrentDrawer` at the app root,
 * not by this page, so what this file can prove about it is that the page asks
 * for it - by the header action and by the deep link. The drawer's own
 * behaviour is `addDepartmentDrawer.integration.test.tsx`.
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
  /** Every drawer the page asked for, and with what. */
  openedDrawers: [] as Array<{ drawer: string; props: unknown }>,
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
    asPath: "/governance/people",
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

// Drawers are URL-routed singletons mounted by `CurrentDrawer` outside this
// page, so the honest thing to assert here is the navigation the page asks
// for. See dev/docs/best_practices/drawers.md, "Testing".
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: (drawer: string, props?: unknown) =>
      harness.openedDrawers.push({ drawer, props }),
    closeDrawer: vi.fn(),
    goBack: vi.fn(),
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
  harness.openedDrawers = [];
});

afterEach(() => cleanup());

describe("the People page tab shell", () => {
  /** @scenario "Switching governance tabs unmounts the inactive content" */
  it("removes the People table when switching to Departments", async () => {
    harness.answers["activityMonitor.spendByUser"] = { data: [JANE] };
    renderPeopleAt(["/governance/people"]);
    const table = screen.getByRole("table");
    await userEvent
      .setup()
      .click(screen.getByRole("tab", { name: "Departments" }));
    await waitFor(() => expect(table).not.toBeInTheDocument());
  });

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
    /** @scenario "Department and sort are chips in one row under the header" */
    it("holds the department and the sort, and offers no time frame", () => {
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
      expect(within(row).getByText("Department")).toBeInTheDocument();
      expect(within(row).getByText("Sort")).toBeInTheDocument();
      // Nothing that changes the table lives anywhere else on the page.
      expect(screen.getAllByText("Sort")).toHaveLength(1);
      expect(findNativeSelects(container)).toHaveLength(0);
      // The guard would pass on a page with no chips at all, so it is worth
      // saying out loud that the row it just read does hold controls.
      expect(within(row).queryByText("Time frame")).not.toBeInTheDocument();
      expect(screen.queryByText("Last 12 months")).not.toBeInTheDocument();
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

  describe("when the department choice is longer than a pill can hold", () => {
    /** @scenario "A choice too long for a pill uses the app's own select" */
    it("offers every department through the app's own select", async () => {
      harness.permissions = MANAGER_PERMISSIONS;
      // Two dozen departments is past the point where a menu pill reads as a
      // list of choices rather than a wall. The dialog takes the organization's
      // department list whole and caps nothing, so the count here is the
      // organization's, not the control's.
      const departments = Array.from({ length: 24 }, (_, index) => ({
        id: `dept-${index + 1}`,
        name: `Department ${index + 1}`,
      }));
      harness.answers["activityMonitor.spendByUser"] = { data: [JANE] };
      harness.answers["departments.list"] = { data: departments };
      // Assigning a department needs an account to assign, so the row has to
      // be one the match engine has already tied to a member.
      harness.answers["governancePeople.list"] = {
        data: [
          discovered({
            displayText: "Jane Doe",
            rawActorId: "jane.doe@example.com",
            link: {
              userId: "user-1",
              evidenceKind: "verified_email",
              memberName: "Jane Doe",
              departmentName: null,
            },
          }),
        ],
      };
      renderPeopleAt(["/governance/people"]);

      await userEvent.click(
        screen.getByRole("button", { name: /Actions for/ }),
      );
      await userEvent.click(
        await screen.findByRole("menuitem", { name: "Assign department" }),
      );

      const dialog = await screen.findByRole("dialog");
      // The app's own select opens through a combobox and a listbox, which is
      // what makes it operable in the app's palette on a dark screen. A native
      // select would hand the whole choice to the operating system.
      const trigger = within(dialog).getByRole("combobox", {
        name: "Department",
      });
      await userEvent.click(trigger);

      // The listbox mounts in a portal directly under the body, which puts it
      // outside the open dialog - so Zag's modal pass marks its container
      // aria-hidden and the default role query skips it. That is a jsdom
      // ordering artifact, not a defect in the control, so the options are
      // read through the listbox the trigger names.
      const listboxId = trigger.getAttribute("aria-controls");
      const listbox = document.getElementById(listboxId ?? "");
      expect(listbox).not.toBeNull();
      const options = within(listbox as HTMLElement).getAllByRole("option", {
        hidden: true,
      });
      // Unassigned plus every department, none dropped for want of room.
      expect(options).toHaveLength(departments.length + 1);
      expect(options.map((option) => option.textContent)).toContain(
        "Department 24",
      );
      // The rule holds with the dialog open, which is the state that used to
      // hide it: Ark marks the page behind a modal aria-hidden, so a check
      // that walked ancestors would pass here without looking at anything.
      expect(findNativeSelects(document.body)).toHaveLength(0);
    });
  });

  describe("when the address already names a department and a sort", () => {
    /** @scenario "The chosen department and sort are part of the address" */
    it("reads both back from the address and asks for the fixed window", () => {
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
        "/governance/people?department=Engineering&sort=requests",
      ]);

      const row = screen.getByTestId("people-filter-row");
      expect(within(row).getByText("Engineering")).toBeInTheDocument();
      expect(within(row).getByText("Requests")).toBeInTheDocument();
      expect(harness.inputs["activityMonitor.spendByUser"]).toMatchObject({
        windowDays: 365,
        sortBy: "requests",
      });
    });
  });

  describe("when a frame is left over in the address from an older link", () => {
    /** @scenario "The spend window is fixed and stated, not chosen" */
    it("ignores it, reads a year, and heads the two figures with it", () => {
      harness.answers["activityMonitor.spendByUser"] = { data: [JANE] };
      renderPeopleAt(["/governance/people?frame=last_2_years"]);

      expect(harness.inputs["activityMonitor.spendByUser"]).toMatchObject({
        windowDays: 365,
      });
      // The window is stated on the columns it is true of. Both of them: one
      // heading carrying it would leave the other figure ambiguous.
      const spend = screen.getByRole("columnheader", { name: /Spend/ });
      const requests = screen.getByRole("columnheader", { name: /Requests/ });
      expect(spend).toHaveTextContent("last 12 months");
      expect(requests).toHaveTextContent("last 12 months");
      expect(
        screen.queryByRole("button", { name: /Time frame/ }),
      ).not.toBeInTheDocument();
    });

    it("prints no paragraph under the table restating either limit", () => {
      // The count line stays; the paragraph that followed it said the window
      // and the sort's reach to a reader looking at neither control.
      harness.answers["activityMonitor.spendByUser"] = { data: [JANE] };
      renderPeopleAt(["/governance/people"]);

      expect(screen.getByText(/person shown\./)).toBeInTheDocument();
      expect(
        screen.queryByText(/everything else covers the whole record/),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/Sorting ranks/)).not.toBeInTheDocument();
    });
  });

  describe("when the sort chip is opened", () => {
    /** @scenario "The page says how far the sort reaches" */
    it("says in the menu which rows the ranking reaches", async () => {
      harness.answers["activityMonitor.spendByUser"] = { data: [JANE] };
      harness.answers["governancePeople.list"] = {
        data: [
          discovered({
            displayText: "Named Only",
            rawActorId: "named.only@example.com",
          }),
        ],
      };
      renderPeopleAt(["/governance/people?sort=lastActivity"]);

      const row = screen.getByTestId("people-filter-row");
      await userEvent.click(within(row).getByText("Sort"));

      const note = await screen.findByText(/Ranks the people/);
      expect(note).toHaveTextContent("Ranks the people with measured spend");
      expect(note).toHaveTextContent(
        "Anyone a connected source named but nothing measured follows, most recently seen first",
      );
      // The limit is stated, not worked around: the chip is still offered and
      // the unrankable rows are still on the table. Hiding either would trade
      // an honest limitation for a worse one.
      expect(within(row).getByText("Sort")).toBeInTheDocument();
      expect(
        screen.getByRole("row", { name: /Named Only/ }),
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
      {/* The kit draws the pressed toggle subtle AND orange
          (SampleDataControls.tsx), so the reference carries the palette too.
          Without it this compares against a grey subtle button and fails for a
          reason that has nothing to do with the rule. */}
      <Button size="sm" variant="subtle" colorPalette="orange">
        reference subtle small
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
    it("puts them last in the header, with only the create action outlined", () => {
      harness.permissions = MANAGER_PERMISSIONS;
      // The toggle is drawn ghost at rest and subtle while pressed, so the
      // state is seeded rather than assumed: this test is about the rest half.
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
      renderPeopleWithReferences("/governance/people");

      const header = screen.getByTestId("people-page-header");
      const outlineSmall = screen.getByText(
        "reference outline small",
      ).className;
      const ghostSmall = screen.getByText("reference ghost small").className;
      const solidSmall = screen.getByText("reference solid small").className;

      const actions = within(header).getAllByRole("button");
      expect(actions).toHaveLength(3);
      // Top-right, not merely somewhere on the page. jsdom computes no layout,
      // so position is asserted structurally: every action follows the title
      // in document order and they share the header's last child, which is the
      // end of a space-between row.
      const heading = within(header).getByRole("heading", { name: "People" });
      const group = header.lastElementChild;
      expect(group).not.toBeNull();
      for (const action of actions) {
        expect(
          heading.compareDocumentPosition(action) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(group).toContainElement(action);
      }
      // Exactly one, not "at most one": a header where nothing is outlined
      // reads as a header with no primary action, which is the drift this rule
      // exists to catch. Nothing here is filled at all any more, so the
      // outline is what carries the distinction.
      expect(
        actions.filter((action) => action.className === outlineSmall),
      ).toHaveLength(1);
      // Adding a department is the only action here that creates something of
      // the organization's own, so it is the outlined one — and it carries the
      // leading plus glyph that goes with the house header button.
      const create = within(header).getByRole("button", {
        name: /Add department/,
      });
      expect(create.className).toBe(outlineSmall);
      expect(create.querySelector("svg")).not.toBeNull();
      // Everything beside it is ghost, and nothing in the row is filled.
      expect(
        within(header).getByRole("button", { name: "Run match pass" })
          .className,
      ).toBe(ghostSmall);
      expect(
        within(header).getByRole("button", { name: /See sample data/ })
          .className,
      ).toBe(ghostSmall);
      expect(
        actions.filter((action) => action.className === solidSmall),
      ).toHaveLength(0);
    });

    /** @scenario "Primary page actions sit top-right in the page header" */
    it("draws the pressed sample toggle subtle, still not solid", async () => {
      harness.permissions = MANAGER_PERMISSIONS;
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
      renderPeopleWithReferences("/governance/people");

      const subtleSmall = screen.getByText("reference subtle small").className;
      const solidSmall = screen.getByText("reference solid small").className;
      const header = screen.getByTestId("people-page-header");

      await userEvent.click(
        within(header).getByRole("button", { name: /See sample data/ }),
      );

      // The toggle changes how it is drawn once it is pressed, and that is the
      // kit's business. What this page owes the section is that pressing it
      // never produces a filled button competing with Add department.
      const pressed = within(header).getByRole("button", {
        name: /sample data/i,
      });
      expect(pressed.className).toBe(subtleSmall);
      expect(pressed.className).not.toBe(solidSmall);
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
    /** @scenario "An empty People page shows samples only when requested" */
    it("fills the table with sample people under a banner", () => {
      answerEverythingEmpty();
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "true");
      renderPeopleAt(["/governance/people"]);

      expect(screen.getByRole("status")).toHaveTextContent(
        /nothing here is real/,
      );
      expect(screen.getByText("Avery Nakamura")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Hide sample data/ }),
      ).toBeInTheDocument();
    });

    /** @scenario "Turning sample data off on an empty page accounts for both halves of the table" */
    it("says nobody was active once the reader turns the samples off", async () => {
      answerEverythingEmpty();
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "true");
      renderPeopleAt(["/governance/people"]);

      await userEvent.click(
        screen.getByRole("button", { name: /Hide sample data/ }),
      );

      expect(
        await screen.findByText(
          "No one has used AI through a connected source, and no connected source has named anyone.",
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
    /** @scenario "Nobody metered and nobody named" */
    it("says so in the People tab", async () => {
      answerEverythingEmpty();
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
      renderPeopleAt(["/governance/people"]);

      expect(
        await screen.findByText(
          "No one has used AI through a connected source, and no connected source has named anyone.",
        ),
      ).toBeInTheDocument();
    });
  });
});

/**
 * The strip renders each figure as a number beside its label, so a figure is
 * read through the label it belongs to rather than by hunting for a bare
 * number that any other part of the page could also be showing.
 */
const summaryFigure = (label: string) => {
  const strip = screen.getByTestId("people-summary-strip");
  return within(strip).getByText(label).previousElementSibling?.textContent;
};

describe("the summary strip above the tabs", () => {
  describe("when every read has answered", () => {
    /** @scenario "The People page opens with a summary strip above its tabs" */
    it("counts the people, the departments and the two gaps worth acting on", () => {
      harness.answers["activityMonitor.spendByUser"] = { data: [JANE, SAM] };
      harness.answers["governancePeople.list"] = {
        data: [
          discovered({
            displayText: "Named Only",
            rawActorId: "named.only@example.com",
          }),
        ],
      };
      harness.answers["departments.list"] = {
        data: [
          { id: "dept-1", name: "Engineering" },
          { id: "dept-2", name: "Finance" },
        ],
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

      // Two spenders plus the person a provider named and nothing metered.
      expect(summaryFigure("people")).toBe("3");
      expect(summaryFigure("departments")).toBe("2");
      // Everyone but the member the assignment names.
      expect(summaryFigure("unmatched")).toBe("2");
      expect(summaryFigure("without a department")).toBe("2");
    });

    /** @scenario "The summary strip sits above the tabs" */
    it("puts the strip before the tab list in the document", () => {
      harness.answers["activityMonitor.spendByUser"] = { data: [JANE] };
      renderPeopleAt(["/governance/people"]);

      const strip = screen.getByTestId("people-summary-strip");
      const tabs = screen.getByRole("tab", { name: "People" });
      expect(
        strip.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  describe("when a read the strip depends on has not answered", () => {
    /** @scenario "A summary figure the page cannot measure reads as an em dash" */
    it("draws an em dash for it rather than a zero", () => {
      harness.answers["activityMonitor.spendByUser"] = { data: [JANE] };
      harness.answers["governancePeople.list"] = { data: [] };
      harness.answers["departments.list"] = { isLoading: true };
      renderPeopleAt(["/governance/people"]);

      expect(summaryFigure("departments")).toBe("—");
      // The half that did answer still reports, so the dash is about the read
      // that did not rather than about the strip giving up.
      expect(summaryFigure("people")).toBe("1");
    });

    /** @scenario "A summary figure the page cannot measure reads as an em dash" */
    it("draws an em dash for a read that was never made, not only one still running", () => {
      // The harder half, and the one a loading flag cannot catch. The spend
      // read is skipped outright for a reader without `activityMonitor:view`
      // and for a non-Enterprise organization, so it is never loading and
      // never will be. Counting the identity half alone would have printed a
      // confident population directly under the permission notice on the
      // table below.
      harness.answers["governancePeople.list"] = { data: [] };
      harness.answers["departments.list"] = { data: [] };
      // No entry at all for the spend read: the shape a disabled query has.
      delete harness.answers["activityMonitor.spendByUser"];
      renderPeopleAt(["/governance/people"]);

      expect(summaryFigure("people")).toBe("—");
      expect(summaryFigure("unmatched")).toBe("—");
      // The department read did answer and is counted, so the dashes above
      // are about the skipped read rather than the strip refusing everything.
      expect(summaryFigure("departments")).toBe("0");
    });
  });

  describe("when the reader has turned the sample data on", () => {
    /** @scenario "In sample mode the summary strip counts the sample rows" */
    it("counts the invented rows, under the page's sample banner", () => {
      answerEverythingEmpty();
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "true");
      renderPeopleAt(["/governance/people"]);

      expect(summaryFigure("people")).toBe("6");
      expect(summaryFigure("departments")).toBe("4");
      // The disclaimer is read before the figures it covers.
      const banner = screen.getByRole("status");
      const strip = screen.getByTestId("people-summary-strip");
      expect(
        banner.compareDocumentPosition(strip) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });
});

describe("the Departments tab", () => {
  describe("when a manager presses Add department", () => {
    /** @scenario "Adding a department opens the create-department drawer" */
    it("navigates to the drawer instead of mounting a dialog", async () => {
      harness.permissions = MANAGER_PERMISSIONS;
      harness.answers["departments.list"] = { data: [] };
      renderPeopleAt(["/governance/people?tab=departments"]);

      await userEvent.click(
        screen.getByRole("button", { name: /Add department/ }),
      );

      expect(harness.openedDrawers.map((entry) => entry.drawer)).toEqual([
        "addDepartment",
      ]);
      // Nothing is mounted from here: the page hands the drawer to the shell
      // and the shell owns the mount.
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  describe("when the address asks for the create-department drawer", () => {
    /** @scenario "The departments address can ask for the create-department drawer" */
    it("selects the Departments tab and asks for the drawer once", async () => {
      harness.permissions = MANAGER_PERMISSIONS;
      harness.answers["departments.list"] = { data: [] };
      renderPeopleAt(["/governance/people?tab=departments&add=1"]);

      expect(screen.getByRole("tab", { name: "Departments" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await waitFor(() =>
        expect(harness.openedDrawers.map((entry) => entry.drawer)).toEqual([
          "addDepartment",
        ]),
      );
    });

    /**
     * The state one navigation later, with the drawer already named in the
     * address. Written as its own entry rather than as a second act of the
     * test above, because the drawer navigation is mocked here: the real
     * `openDrawer` is what puts `drawer.open` in the address, so the only
     * honest way to reach this state in this file is to start in it.
     */
    /** @scenario "The request to add a department leaves the address once the drawer has it" */
    it("clears the request and leaves the tab and the drawer in place", async () => {
      harness.permissions = MANAGER_PERMISSIONS;
      harness.answers["departments.list"] = { data: [] };
      const router = renderPeopleAt([
        "/governance/people?tab=departments&add=1&drawer.open=addDepartment",
      ]);

      await waitFor(() =>
        expect(router.state.location.search).not.toContain("add=1"),
      );
      expect(router.state.location.search).toContain("tab=departments");
      expect(router.state.location.search).toContain(
        "drawer.open=addDepartment",
      );
      // Already open: asking again would push a second entry onto the stack.
      expect(harness.openedDrawers).toEqual([]);
    });

    /** @scenario "A viewer without the manage grant is not offered the create-department drawer" */
    it("opens nothing for a viewer who cannot create one", async () => {
      harness.answers["departments.list"] = { data: [] };
      const router = renderPeopleAt([
        "/governance/people?tab=departments&add=1",
      ]);

      await waitFor(() =>
        expect(router.state.location.search).not.toContain("add=1"),
      );
      expect(harness.openedDrawers).toEqual([]);
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
