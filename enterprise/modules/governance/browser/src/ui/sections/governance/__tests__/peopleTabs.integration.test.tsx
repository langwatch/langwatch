/**
 * @vitest-environment jsdom
 * The People page as a delegated viewer and an admin meet it: tabs, one table, filters, sample
 * data, the plan lock, the summary strip and the department drawer. Real page, mocked boundary.
 * @see specs/ai-governance/dashboard/people-tabs.feature
 */
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SAMPLE_DEPARTMENTS,
  samplePeopleRows,
} from "../../../../features/people/model/sample-people.ts";
import {
  FakeGovernanceHost,
  findNativeSelects,
  renderWithGovernanceHost,
} from "../../../../testing.tsx";
import { SAMPLE_CHOICE_KEY } from "../../../elements/governance-sample-mode.ts";

const harness = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  errors: {} as Record<string, unknown>,
  requested: [] as string[],
  inputs: {} as Record<string, unknown>,
  calls: [] as { path: string; input: unknown }[],
  invalidated: [] as string[],
  openDrawer: vi.fn(),
  closeDrawer: vi.fn(),
}));

vi.mock("@langwatch/browser-host/drawer", async () => ({
  ...(await vi.importActual("@langwatch/browser-host/drawer")),
  useDrawer: () => ({
    openDrawer: harness.openDrawer,
    closeDrawer: harness.closeDrawer,
    goBack: vi.fn(),
  }),
}));

vi.mock("../../../../behavior/governance-api.ts", () => {
  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          const here = path.join(".");
          if (property === "useQuery") {
            return (input: unknown, options?: { enabled?: boolean }) => {
              if (options?.enabled !== false) {
                harness.requested.push(here);
                harness.inputs[here] = input;
              }
              return {
                data: harness.data[here],
                error: harness.errors[here] ?? null,
                isLoading: false,
                isFetching: false,
                isError: false,
                refetch: vi.fn(),
              };
            };
          }
          if (property === "useMutation") {
            return (options?: { onSuccess?: (answer: unknown) => unknown }) => ({
              mutate: (input: unknown) => {
                harness.calls.push({ path: here, input });
                void options?.onSuccess?.(harness.data[here]);
              },
              mutateAsync: async (input: unknown) => {
                harness.calls.push({ path: here, input });
              },
              isPending: false,
              variables: undefined,
            });
          }
          if (property === "invalidate") {
            return async () => void harness.invalidated.push(here);
          }
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );
  return { api: node([]) };
});

import { CreateDepartmentDrawer } from "../../../../features/people/ui/create-department-drawer.tsx";
import PeoplePage from "../governance-people.screen.tsx";

const ADMIN = ["activityMonitor:view", "governance:manage", "ingestionSources:view"];
const VIEWER = ["governance:view", "activityMonitor:view"];
const SEEN = "2026-08-01T00:00:00.000Z";

const spend = (over: Record<string, unknown>) => ({
  actor: "ada@acme.test",
  spendUsd: "12.5",
  requests: 42,
  lastActivityIso: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  trendVsPreviousPct: 0,
  hasPriorBaseline: false,
  mostUsedTarget: null,
  ...over,
});

const person = (over: Record<string, unknown>) => ({
  id: `person_${typeof over.displayText === "string" ? over.displayText : "x"}`,
  provider: "copilot_studio_dataverse",
  kind: "person",
  displayText: "Someone",
  rawActorId: "someone",
  directoryDepartment: null,
  firstSeenAt: SEEN,
  lastSeenAt: SEEN,
  erasedAt: null,
  suspendedAt: null,
  suspendedReason: null,
  link: null,
  ...over,
});

function renderPage({
  permissions = VIEWER,
  query = {},
  plan,
}: {
  permissions?: string[];
  query?: Record<string, string>;
  plan?: { isEnterprise: boolean; isLoading: boolean };
} = {}) {
  const host = FakeGovernanceHost.create({ permissions, query, ...(plan ? { plan } : {}) });
  const view = renderWithGovernanceHost(
    <MemoryRouter initialEntries={["/governance/people"]}>
      <PeoplePage />
    </MemoryRouter>,
    { host },
  );
  return { host, ...view };
}

const chip = (label: string) => {
  const found = screen.getAllByRole("button").find((b) => b.textContent?.startsWith(label));
  if (!found) throw new Error(`no ${label} chip`);
  return found;
};
const pick = async ({ chipLabel, option }: { chipLabel: string; option: string }) => {
  await userEvent.click(chip(chipLabel));
  await userEvent.click(await screen.findByRole("menuitem", { name: option }));
};
const rowOf = (name: RegExp) => screen.getByRole("row", { name });
const figure = (key: string) => screen.getByTestId(`people-summary-strip-${key}`);
const toggle = () => screen.getByRole("button", { name: /sample data/i });

beforeEach(() => {
  window.sessionStorage.clear();
  harness.data = {
    "activityMonitor.spendByUser": [],
    "governancePeople.list": [],
    "governancePeople.suggestions": [],
    "departments.list": [],
    "departments.assignments": { users: [], teams: [], projects: [] },
    "ingestionSources.list": [],
  };
  harness.errors = {};
  harness.requested = [];
  harness.inputs = {};
  harness.calls = [];
  harness.invalidated = [];
  harness.openDrawer.mockReset();
  harness.closeDrawer.mockReset();
});

afterEach(() => cleanup());

describe("given sam, a delegated viewer, opens the People page", () => {
  describe("given no tab in the address", () => {
    /** @scenario "The default tab is People" */
    it("selects the People tab, requests the table and writes no tab parameter", () => {
      const { host } = renderPage();

      expect(screen.getByRole("tab", { name: /^People/ })).toHaveAttribute("aria-selected", "true");
      expect(harness.requested).toContain("activityMonitor.spendByUser");
      expect(harness.requested).toContain("governancePeople.list");
      expect(host.recording.queries.filter((write) => "tab" in write.next)).toEqual([]);
    });
  });

  describe("given the tab set to departments", () => {
    /** @scenario "The Departments tab is addressable" */
    it("selects the Departments tab and requests the department list", () => {
      renderPage({ query: { tab: "departments" } });

      expect(screen.getByRole("tab", { name: /^Departments/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(harness.requested).toContain("departments.list");
    });
  });

  describe("when one person used AI through a connected source", () => {
    beforeEach(() => {
      harness.data["activityMonitor.spendByUser"] = [spend({})];
    });

    /** @scenario "The People table renders each person with spend, requests and last activity" */
    it("lists them by name with spend, requests, last activity and a link to their page", () => {
      renderPage();

      const row = rowOf(/ada/);
      expect(within(row).getByRole("link", { name: "ada" })).toHaveAttribute(
        "href",
        "/governance/users/ada%40acme.test",
      );
      expect(within(row).getByText("$12.50")).toBeInTheDocument();
      expect(within(row).getByText("42")).toBeInTheDocument();
      expect(within(row).getByText("2 hours ago")).toBeInTheDocument();
    });

    /** @scenario "Sample data steps aside once real people arrive" */
    it("keeps the sample people off screen and still offers to show them", () => {
      renderPage();

      expect(screen.getAllByRole("row")).toHaveLength(2);
      expect(toggle()).toHaveAccessibleName("See sample data");
    });

    /** @scenario "The spend window is fixed and stated, not chosen" */
    it("asks for a year whatever the address names, says so on the headings and offers no window control", () => {
      renderPage({ query: { window: "30", frame: "30d" } });

      expect(harness.inputs["activityMonitor.spendByUser"]).toMatchObject({ windowDays: 365 });
      expect(screen.getAllByText("last 12 months")).toHaveLength(2);
      expect(screen.queryByRole("button", { name: /window|time frame/i })).toBeNull();
    });
  });

  describe("when a member of the organization is assigned to Engineering and used AI", () => {
    /** @scenario "A person matching an organization member shows that member's department" */
    it("shows Engineering as the department on the member's row", () => {
      harness.data["activityMonitor.spendByUser"] = [spend({})];
      harness.data["departments.list"] = [{ id: "dept_eng", name: "Engineering" }];
      harness.data["departments.assignments"] = {
        users: [{ id: "u_ada", email: "ada@acme.test", name: "Ada", departmentId: "dept_eng" }],
        teams: [],
        projects: [],
      };
      renderPage();

      expect(within(rowOf(/ada/)).getByText("Engineering")).toBeInTheDocument();
    });
  });

  describe("when two people's most-used targets differ in whether a source matches", () => {
    /** @scenario "A most-used chip links to its source only when a source matches" */
    it("links the chip to the source's inventory page and leaves the other plain", () => {
      harness.data["activityMonitor.spendByUser"] = [
        spend({ actor: "ada@acme.test", mostUsedTarget: "Copilot Studio" }),
        spend({ actor: "bo@acme.test", mostUsedTarget: "gpt-5" }),
      ];
      harness.data["ingestionSources.list"] = [
        { id: "src_1", name: "Copilot Studio", sourceType: "copilot_studio_dataverse" },
      ];
      renderPage({ permissions: [...VIEWER, "ingestionSources:view"] });

      expect(within(rowOf(/ada/)).getByText("Copilot Studio").closest("a")).toHaveAttribute(
        "href",
        "/governance/inventory/src_1",
      );
      expect(within(rowOf(/bo/)).getByText("gpt-5").closest("a")).toBeNull();
    });
  });

  describe("when a provider named a person nothing metered", () => {
    /** @scenario "A person the providers named with no spend behind them is on the same table" */
    it("puts them on the table with spend and requests read as not measured", () => {
      harness.data["activityMonitor.spendByUser"] = [spend({})];
      harness.data["governancePeople.list"] = [
        person({ displayText: "Nobody Metered", rawActorId: "nobody@ext.test" }),
      ];
      renderPage();

      expect(screen.getAllByRole("row")).toHaveLength(3);
      const row = rowOf(/Nobody Metered/);
      expect(within(row).getAllByLabelText("not measured")).toHaveLength(2);
      expect(within(row).queryByText(/\$/)).toBeNull();
    });
  });

  describe("when a spend row and one discovered person name the same address", () => {
    /** @scenario "A spend row and the discovered person naming the same identifier are one row" */
    it("holds one row carrying both the spend and the provider", () => {
      harness.data["activityMonitor.spendByUser"] = [spend({ actor: "m.silva@example.com" })];
      harness.data["governancePeople.list"] = [
        person({ displayText: "M Silva", rawActorId: "m.silva@example.com" }),
      ];
      renderPage();

      const rows = screen.getAllByRole("row", { name: /M Silva/ });
      expect(rows).toHaveLength(1);
      expect(within(rows[0] ?? document.body).getByText("$12.50")).toBeInTheDocument();
      expect(within(rows[0] ?? document.body).getByText(/Copilot/)).toBeInTheDocument();
    });
  });

  describe("when the people are linked, unlinked and erased", () => {
    /** @scenario "Every row says whether we know the account behind it" */
    it("reads their rows as matched, unmatched and erased in turn", () => {
      harness.data["governancePeople.list"] = [
        person({
          displayText: "Linked Lin",
          rawActorId: "lin@ext.test",
          link: {
            userId: "u_1",
            evidenceKind: "verified_email",
            memberName: "Lin",
            departmentName: null,
          },
          lastSeenAt: "2026-08-03T00:00:00.000Z",
        }),
        person({
          displayText: "Free Fay",
          rawActorId: "fay@ext.test",
          lastSeenAt: "2026-08-02T00:00:00.000Z",
        }),
        person({ displayText: "pseudonym_z", rawActorId: "pseudonym_z", erasedAt: SEEN }),
      ];
      renderPage();

      expect(within(rowOf(/Linked Lin/)).getByText("Matched")).toBeInTheDocument();
      expect(within(rowOf(/Free Fay/)).getByText("Unmatched")).toBeInTheDocument();
      expect(within(rowOf(/pseudonym_z/)).getByText("Erased")).toBeInTheDocument();
    });
  });

  describe("and looks at the filters", () => {
    /** @scenario "Department and sort are chips in one row under the header" */
    it("holds the department and the sort in one row, offers no time frame and no native select", () => {
      harness.data["activityMonitor.spendByUser"] = [spend({})];
      const { container } = renderPage();

      const row = screen.getByTestId("people-filter-row");
      expect(
        within(row)
          .getAllByRole("button")
          .map((b) => b.textContent),
      ).toEqual([expect.stringMatching(/^Department/), expect.stringMatching(/^Sort/)]);
      expect(
        screen.getAllByRole("button").filter((b) => (b.textContent ?? "").startsWith("Time")),
      ).toEqual([]);
      expect(findNativeSelects(container)).toEqual([]);
    });

    /** @scenario "The page says how far the sort reaches" */
    it("says the ranking reaches the people with measured spend and the named ones follow", async () => {
      renderPage();

      await userEvent.click(chip("Sort"));

      expect(await screen.findByText(/Ranks the people with measured spend/)).toHaveTextContent(
        /named but nothing measured follows, most recently seen first/,
      );
    });
  });

  describe("when people sit in two departments", () => {
    beforeEach(() => {
      harness.data["governancePeople.list"] = [
        person({
          displayText: "Ada Lovelace",
          rawActorId: "ada@ext.test",
          directoryDepartment: "Engineering",
        }),
        person({
          displayText: "Bo Kim",
          rawActorId: "bo@ext.test",
          directoryDepartment: "Finance",
        }),
      ];
    });

    /** @scenario "The department chip filters the table to that department" */
    it("lists only the picked department's people", async () => {
      renderPage();

      await pick({ chipLabel: "Department", option: "Finance" });

      expect(screen.queryByRole("row", { name: /Ada Lovelace/ })).toBeNull();
      expect(rowOf(/Bo Kim/)).toBeInTheDocument();
    });

    /** @scenario "The chosen department and sort are part of the address" */
    it("writes each choice to the address and reads the same choices back from it", async () => {
      const { host } = renderPage();

      await pick({ chipLabel: "Department", option: "Finance" });
      await pick({ chipLabel: "Sort", option: "Requests" });

      expect(host.recording.queries.at(-1)?.next).toMatchObject({
        department: "Finance",
        sort: "requests",
      });
      cleanup();
      renderPage({ query: { department: "Finance", sort: "requests" } });
      expect(chip("Department")).toHaveTextContent("Finance");
      expect(chip("Sort")).toHaveTextContent("Requests");
    });
  });

  describe("when the organization's plan lacks the activity monitor", () => {
    const LOCKED = { isEnterprise: false, isLoading: false };

    /** @scenario "Enterprise-locked activity shows a quiet line, not an alert" */
    it("shows the muted Enterprise line, sends no spend request and shows no alert", () => {
      renderPage({ plan: LOCKED });

      expect(screen.getByTestId("people-enterprise-locked")).toHaveTextContent(/Enterprise/);
      expect(harness.requested).not.toContain("activityMonitor.spendByUser");
      expect(screen.queryByRole("alert")).toBeNull();
    });

    /** @scenario "Enterprise-locked activity shows a quiet line, not an alert" */
    it("renders the same muted line for a server refusal naming the plan", () => {
      harness.errors["activityMonitor.spendByUser"] = {
        data: { error: { code: "enterprise_plan_required", httpStatus: 402 } },
      };
      renderPage();

      expect(screen.getByTestId("people-enterprise-locked")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    /** @scenario "Sample mode shows no error alerts, not even the plan refusal" */
    it("drops the alert and the locked line and shows the sample people once samples are on", async () => {
      harness.errors["governancePeople.list"] = {
        data: { error: { code: "boom", httpStatus: 500 } },
      };
      renderPage({ plan: LOCKED });

      await userEvent.click(toggle());

      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByTestId("people-enterprise-locked")).toBeNull();
      expect(screen.getAllByRole("row")).toHaveLength(samplePeopleRows().length + 1);
    });
  });

  describe("when the reads answered and none holds a row", () => {
    /** @scenario "An empty People page shows samples only when requested" */
    it("fills the table with sample people and a banner saying nothing on the page is real", () => {
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "true");
      renderPage();

      expect(screen.getAllByRole("row")).toHaveLength(samplePeopleRows().length + 1);
      expect(screen.getByRole("status")).toHaveTextContent(/nothing here is real/);
    });

    /** @scenario "Turning sample data off on an empty page accounts for both halves of the table" */
    it("says nobody used AI and no source named anyone once samples are turned off", async () => {
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "true");
      renderPage();

      await userEvent.click(toggle());

      expect(
        screen.getByText(
          "No one has used AI through a connected source, and no connected source has named anyone.",
        ),
      ).toBeInTheDocument();
    });

    /** @scenario "Nobody metered and nobody named" */
    it("says nobody used AI and no source named anyone to a reader who chose no samples", () => {
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
      renderPage();

      expect(
        screen.getByText(
          "No one has used AI through a connected source, and no connected source has named anyone.",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("when the page has answered reads for three people and two departments", () => {
    beforeEach(() => {
      harness.data["activityMonitor.spendByUser"] = [
        spend({ actor: "a@acme.test" }),
        spend({ actor: "b@acme.test" }),
      ];
      harness.data["governancePeople.list"] = [
        person({ displayText: "Cy Named", rawActorId: "cy@ext.test" }),
      ];
      harness.data["departments.list"] = [
        { id: "dept_eng", name: "Engineering" },
        { id: "dept_ops", name: "Ops" },
      ];
      harness.data["departments.assignments"] = {
        users: [{ id: "u_a", email: "a@acme.test", name: "Ava", departmentId: "dept_eng" }],
        teams: [],
        projects: [],
      };
    });

    /** @scenario "The People page opens with a summary strip above its tabs" */
    it("says three people, two departments, two unmatched and two without a department", () => {
      renderPage();

      expect(figure("people")).toHaveTextContent(/^3people/);
      expect(figure("departments")).toHaveTextContent(/^2departments/);
      expect(figure("unmatched")).toHaveTextContent(/^2unmatched/);
      expect(figure("unassigned")).toHaveTextContent(/^2without a department/);
    });

    /** @scenario "The summary strip sits above the tabs" */
    it("puts the strip before the tab list", () => {
      renderPage();

      const order = screen
        .getByTestId("people-summary-strip")
        .compareDocumentPosition(screen.getByRole("tablist"));
      expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  describe("when the department list has not answered", () => {
    /** @scenario "A summary figure the page cannot measure reads as an em dash" */
    it("reads the department figure as an em dash while the people figure reports what answered", () => {
      harness.data["departments.list"] = undefined;
      harness.data["activityMonitor.spendByUser"] = [spend({})];
      renderPage();

      expect(figure("departments")).toHaveTextContent(/^—departments/);
      expect(figure("people")).toHaveTextContent(/^1people/);
    });
  });

  describe("when the reader has turned the sample data on", () => {
    /** @scenario "In sample mode the summary strip counts the sample rows" */
    it("counts the invented people and departments, under the banner", () => {
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "true");
      renderPage();

      expect(figure("people")).toHaveTextContent(new RegExp(`^${samplePeopleRows().length}people`));
      expect(figure("departments")).toHaveTextContent(
        new RegExp(`^${SAMPLE_DEPARTMENTS.length}departments`),
      );
      const order = screen
        .getByRole("status")
        .compareDocumentPosition(screen.getByTestId("people-summary-strip"));
      expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });
});

describe("given alice, an organization admin, on the People page", () => {
  describe("given a person on the table", () => {
    beforeEach(() => {
      harness.data["activityMonitor.spendByUser"] = [spend({})];
      harness.data["governancePeople.runMatch"] = { linked: 0, unproven: 0 };
    });

    /** @scenario "Run match pass is a header action, not a panel's own button" */
    it("runs the proof pass from the one Run match pass button, which sits in the header", async () => {
      renderPage({ permissions: ADMIN });

      const buttons = screen.getAllByRole("button", { name: /Run match pass/ });
      expect(buttons).toHaveLength(1);
      expect(
        within(screen.getByTestId("people-page-header")).getByRole("button", {
          name: /Run match pass/,
        }),
      ).toBe(buttons[0]);
      await userEvent.click(buttons[0] ?? document.body);

      expect(harness.calls).toEqual([
        { path: "governancePeople.runMatch", input: { organizationId: "org-1" } },
      ]);
    });
  });

  describe("when a person linked to a member has an actions menu", () => {
    /** @scenario "Assigning a department to a person uses the app's own select" */
    it("opens the assign-department dialog with no native select element on the page", async () => {
      harness.data["governancePeople.list"] = [
        person({
          displayText: "Linked Lin",
          rawActorId: "lin@ext.test",
          link: {
            userId: "u_1",
            evidenceKind: "verified_email",
            memberName: "Lin",
            departmentName: null,
          },
        }),
      ];
      harness.data["departments.list"] = [{ id: "dept_eng", name: "Engineering" }];
      renderPage({ permissions: ADMIN });

      await userEvent.click(screen.getByRole("button", { name: "Actions for Linked Lin" }));
      await userEvent.click(await screen.findByRole("menuitem", { name: "Assign department" }));

      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(findNativeSelects(document.body)).toEqual([]);
    });
  });

  describe("when she presses Add department", () => {
    /** @scenario "Adding a department opens the create-department drawer" */
    it("navigates to the drawer by name and mounts no dialog of its own", async () => {
      renderPage({ permissions: ADMIN });
      await userEvent.click(screen.getByRole("button", { name: /Add department/ }));

      expect(harness.openDrawer).toHaveBeenCalledWith("addDepartment");
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    /** @scenario "The departments address can ask for the create-department drawer" */
    it("selects the Departments tab and navigates to the drawer when the address asks", async () => {
      renderPage({ permissions: ADMIN, query: { tab: "departments", add: "1" } });

      expect(screen.getByRole("tab", { name: /Departments/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await waitFor(() => expect(harness.openDrawer).toHaveBeenCalledWith("addDepartment"));
    });

    /** @scenario "The request to add a department leaves the address once the drawer has it" */
    it("takes the add request out of the address, keeps the rest and asks for no second drawer", () => {
      const { host } = renderPage({
        permissions: ADMIN,
        query: { tab: "departments", add: "1", "drawer.open": "addDepartment" },
      });

      expect(host.recording.queries.at(-1)?.next).toEqual({
        tab: "departments",
        "drawer.open": "addDepartment",
      });
      expect(harness.openDrawer).not.toHaveBeenCalled();
    });
  });

  describe("when she opens the create-department drawer", () => {
    const openDrawer = async () => {
      const host = FakeGovernanceHost.create({ permissions: ADMIN });
      renderWithGovernanceHost(<CreateDepartmentDrawer />, { host });
      return { host, drawer: await screen.findByRole("dialog") };
    };

    /** @scenario "The create-department drawer collects every field the department model has" */
    it("offers a named field for the department name and a Create action, and nothing else to fill", async () => {
      const { drawer } = await openDrawer();

      expect(within(drawer).getAllByRole("textbox")).toHaveLength(1);
      expect(within(drawer).getByRole("textbox", { name: "Department name" })).toBeInTheDocument();
      expect(within(drawer).getByRole("button", { name: "Create" })).toBeInTheDocument();
    });

    /** @scenario "Creating a department from the drawer records it and closes" */
    it("records the name without its surrounding spaces, closes and reads the list again", async () => {
      const { drawer } = await openDrawer();

      await userEvent.type(
        within(drawer).getByRole("textbox", { name: "Department name" }),
        "  Legal  ",
      );
      await userEvent.click(within(drawer).getByRole("button", { name: "Create" }));

      await waitFor(() => expect(harness.closeDrawer).toHaveBeenCalled());
      expect(harness.calls).toEqual([
        { path: "departments.create", input: { organizationId: "org-1", name: "Legal" } },
      ]);
      expect(harness.invalidated).toContain("departments.list");
    });

    /** @scenario "A department with no name is refused at the field" */
    it("shows the refusal beside the name field and sends nothing", async () => {
      const { drawer } = await openDrawer();

      await userEvent.click(within(drawer).getByRole("button", { name: "Create" }));

      expect(within(drawer).getByText("Give the department a name.")).toBeInTheDocument();
      expect(harness.calls).toEqual([]);
      expect(harness.closeDrawer).not.toHaveBeenCalled();
    });
  });

  /** @scenario "A viewer who reaches the create-department drawer is told which grant it needs" */
  it("names the governance:manage grant and offers no name field or Create action by address", async () => {
    const host = FakeGovernanceHost.create({ permissions: VIEWER });
    renderWithGovernanceHost(<CreateDepartmentDrawer />, { host });
    const drawer = await screen.findByRole("dialog");

    expect(within(drawer).getByText(/governance:manage/)).toBeInTheDocument();
    expect(within(drawer).queryByRole("textbox")).toBeNull();
    expect(within(drawer).queryByRole("button", { name: "Create" })).toBeNull();
  });
});

describe("given sam, a viewer without the manage grant", () => {
  /** @scenario "A viewer without the manage grant is not offered the create-department drawer" */
  it("takes the add request out of the address and opens no drawer", () => {
    const { host } = renderPage({ query: { tab: "departments", add: "1" } });

    expect(host.recording.queries.at(-1)?.next).toEqual({ tab: "departments" });
    expect(harness.openDrawer).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
