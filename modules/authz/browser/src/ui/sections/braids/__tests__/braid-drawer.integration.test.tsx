/**
 * @vitest-environment jsdom
 * The New braid and Edit braid drawer, opened from the Braids page by its URL.
 * Spec: modules/authz/specs/braids-screen.feature, "The dialog builds a braid".
 */

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/trace-client", async () => ({
  traceClient: (await import("./braids-api-fake.ts")).braidTraces.traceClient,
}));
vi.mock("../../../../behavior/authz-api.ts", async () => ({
  authzApi: (await import("./braids-api-fake.ts")).braidsFake.api,
}));

// Isolation is off: reload so the screen binds this file's mocks, not a sibling suite's.
vi.resetModules();
const { braidsFake, braidTraces, liveBraid } = await import("./braids-api-fake.ts");
const { FakeAuthzHost, renderWithAuthzHost } = await import("../../../../testing.tsx");
const { default: BraidsScreen } = await import("../braids.screen.tsx");

const STRUCTURE = {
  organizationName: "Acme",
  teams: [{ id: "t-1", name: "Agents" }],
  projects: [
    { id: "p-orch", name: "orchestrator", teamId: "t-1" },
    { id: "p-spec", name: "specialists", teamId: "t-1" },
    { id: "p-roll", name: "rollup", teamId: "t-1" },
  ],
};
const CONDITION = 'attributes["orchestrator"] == "web"';

function openDrawer({ braid = "new" }: { braid?: string } = {}) {
  const host = new FakeAuthzHost({
    scope: { organizationId: "org-1", projectId: "p-spec" },
    grants: new Set(["project:view", "braids:manage"]),
    plan: { isEnterprise: true, isLoading: false },
    query: { braid },
    structure: STRUCTURE,
  });
  renderWithAuthzHost(<BraidsScreen />, host);
  return { host, user: userEvent.setup() };
}

async function pickReader(user: ReturnType<typeof userEvent.setup>, name = "orchestrator") {
  await user.click(screen.getByTestId("braid-into"));
  const option = screen
    .getAllByTestId("braid-target")
    .find((item) => within(item).queryByText(name));
  if (!option) throw new Error(`${name} is not offered`);
  await user.click(option);
}

async function writeCondition(user: ReturnType<typeof userEvent.setup>, text: string) {
  const editor = screen.getByTestId("braid-condition");
  await user.clear(editor);
  await user.click(editor);
  await user.paste(text);
}

beforeEach(() => {
  const { state } = braidsFake;
  state.project = { intoOtherProjects: [], fromOtherProjects: [] };
  state.targets = [
    { projectId: "p-orch", selectable: true },
    { projectId: "p-spec", selectable: false, reason: "this_project" },
    { projectId: "p-roll", selectable: false, reason: "aggregate" },
  ];
  state.viewers = { count: 14, exact: true };
  state.signingKeys = [];
  state.saveError = undefined;
  state.create.mockClear();
  state.change.mockClear();
  braidTraces.state.attributeKeys = [{ key: "orchestrator", spanCount: 4210 }];
  braidTraces.state.preview = {
    refusal: null,
    traces: { every: 1200, some: 300, none: 3402, total: 4902, capped: false },
    unsignedHidden: null,
  };
  braidTraces.state.previewAsked.mockClear();
});

describe("the braid drawer", () => {
  describe("when ana starts a new braid", () => {
    /** @scenario The braid starts from this project and picks where it goes */
    it("fixes the project it braids from and lists the readable projects, refusing two", async () => {
      const { user } = openDrawer();

      expect(
        screen.getByText(
          "Show specialists's spans inside another project's traces. Nothing is copied.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByTestId("braid-from")).toHaveTextContent("specialists");
      await user.click(screen.getByTestId("braid-into"));
      const options = screen.getAllByTestId("braid-target");
      expect(options.map((option) => option.textContent)).toEqual([
        "orchestrator",
        "specialistsThis project",
        "rollupAggregate projects can't be braided",
      ]);
      expect(options[0]).not.toHaveAttribute("data-disabled");
      expect(options[1]).toHaveAttribute("data-disabled");
      expect(options[2]).toHaveAttribute("data-disabled");
    });
  });

  describe("when the viewer cannot read a project's traces", () => {
    /** @scenario A team admin is offered only the projects they can read */
    it("leaves it out and says why", async () => {
      braidsFake.state.targets = [
        { projectId: "p-spec", selectable: false, reason: "this_project" },
      ];
      const { user } = openDrawer();

      await user.click(screen.getByTestId("braid-into"));
      expect(screen.queryByText("orchestrator")).not.toBeInTheDocument();
      expect(screen.getByTestId("braid-targets-note")).toHaveTextContent(
        "A braid can only go into a project whose traces you can read.",
      );
    });
  });

  describe("when the condition uses an or", () => {
    /** @scenario The condition is checked as it is typed */
    it("marks the or, says how to write it instead and keeps create disabled", async () => {
      const { user } = openDrawer();
      await pickReader(user);

      await writeCondition(user, `${CONDITION} or attributes["team"] == "a"`);

      expect(screen.getByTestId("braid-condition-check")).toHaveAttribute("role", "alert");
      expect(within(screen.getByTestId("braid-condition-refused")).getByText("or")).toBeVisible();
      expect(screen.getByTestId("braid-save")).toBeDisabled();

      await writeCondition(user, CONDITION);
      expect(screen.getByTestId("braid-condition-check")).toHaveTextContent("Looks good");
      expect(screen.getByTestId("braid-save")).toBeEnabled();
    });
  });

  describe("when ana inserts an attribute the owner's spans carry", () => {
    /** @scenario The attributes this project's spans carry can be inserted into the condition */
    it("inserts it at the cursor with the caret inside the quotes", async () => {
      const { user } = openDrawer();

      await user.click(screen.getByTestId("braid-insert-attribute"));
      await user.click(screen.getByTestId("braid-attribute"));

      const editor = screen.getByTestId<HTMLTextAreaElement>("braid-condition");
      expect(editor).toHaveValue('attributes["orchestrator"] == ""');
      await waitFor(() => expect(editor.selectionStart).toBe(editor.value.length - 1));
    });
  });

  describe("when the reader has a signing key in use", () => {
    /** @scenario The signed calls switch and the condition stay in step */
    it("adds and removes Verified with the switch and names the key", async () => {
      braidsFake.state.signingKeys = [
        { id: "k-1", name: "Production", status: "active", lastUsedAt: "2026-10-22T09:00:00Z" },
      ];
      const { user } = openDrawer();
      await pickReader(user);
      await writeCondition(user, CONDITION);

      await user.click(screen.getByRole("checkbox", { name: "Only signed calls" }));
      expect(screen.getByTestId("braid-condition")).toHaveValue(
        `${CONDITION} and Verified("orchestrator")`,
      );
      expect(screen.getByRole("checkbox", { name: "Only signed calls" })).toBeChecked();
      expect(screen.getByTestId("braid-signing-key")).toHaveTextContent(
        /orchestrator signs its calls · key “Production”, last used .+ ago/,
      );

      await writeCondition(user, CONDITION);
      expect(screen.getByRole("checkbox", { name: "Only signed calls" })).not.toBeChecked();
    });
  });

  describe("when the reader has no signing key", () => {
    /** @scenario Only signed calls offers to set up signing when the reader has no key */
    it("says the reader does not sign yet and where to set it up", async () => {
      const { user } = openDrawer();
      await pickReader(user);

      await user.click(screen.getByRole("checkbox", { name: "Only signed calls" }));

      const line = screen.getByTestId("braid-signing-key");
      expect(line).toHaveTextContent("orchestrator doesn't sign its calls yet");
      expect(within(line).getByRole("link", { name: "How signing works" })).toBeInTheDocument();
    });
  });

  describe("when ana stops typing a supported condition", () => {
    it("counts the reader's traces getting every, some or none, and the unsigned calls", async () => {
      braidTraces.state.preview = {
        refusal: null,
        traces: { every: 1200, some: 300, none: 3402, total: 4902, capped: true },
        unsignedHidden: 37,
      };
      const { user } = openDrawer();
      await pickReader(user);
      await writeCondition(user, `${CONDITION} and Verified("orchestrator")`);

      const counts = await screen.findByTestId("braid-preview-counts");
      expect(counts).toHaveTextContent("1,500 of 4,902 traces get spans");
      expect(counts).toHaveTextContent("Every specialists span1,200");
      expect(screen.getByTestId("braid-preview-capped")).toBeInTheDocument();
      expect(screen.getByTestId("braid-preview-unsigned")).toHaveTextContent("37 calls");
      expect(braidTraces.state.previewAsked).toHaveBeenLastCalledWith(
        expect.objectContaining({ projectId: "p-spec", readerProjectId: "p-orch" }),
      );
    });
  });

  describe("when ana tests a trace id", () => {
    /** @scenario Testing a trace shows it exactly as the reader will see it */
    it("shows the reader's spans, the braided ones marked and the rest struck through", async () => {
      const span = (spanId: string, name: string, extra: object = {}) => ({
        spanId,
        parentSpanId: spanId === "s-1" ? null : "s-1",
        name,
        type: null,
        startTimeMs: Number(spanId.slice(2)),
        endTimeMs: 10,
        durationMs: 1,
        status: "ok",
        model: null,
        ...extra,
      });
      braidTraces.state.testTrace = {
        found: true,
        nodes: [
          span("s-1", "handle_message"),
          span("s-2", "payments_agent", { ownerProjectId: "p-spec", braided: true }),
          span("s-3", "fraud_check", { ownerProjectId: "p-spec", braided: false }),
        ],
      };
      const { user } = openDrawer();
      await pickReader(user);

      await user.type(screen.getByRole("textbox", { name: "Trace id" }), "4bf92f3577b34da6");
      await user.click(screen.getByTestId("braid-test"));

      const trace = await screen.findByTestId("braid-test-trace");
      expect(trace).toHaveTextContent("Only you see this test; nothing is saved.");
      const spans = within(trace).getAllByTestId("braid-test-span");
      expect(spans.map((row) => row.dataset.kind)).toEqual(["own", "braided", "withheld"]);
      expect(within(spans[2] as HTMLElement).getByText("fraud_check")).toHaveStyle({
        textDecoration: "line-through",
      });
    });
  });

  describe("when ana picks the project to braid into", () => {
    /** @scenario The dialog names how many people will see the spans */
    it("says how many of its members will see the braided spans", async () => {
      const { user } = openDrawer();
      await pickReader(user);

      expect(screen.getByTestId("braid-viewers")).toHaveTextContent(
        "14 people in orchestrator will see these spans",
      );
    });
  });

  describe("when ana completes the braid", () => {
    /** @scenario Creating the braid names the project it goes into */
    it("names the reader on the button, creates it and closes", async () => {
      const { host, user } = openDrawer();
      await pickReader(user);
      await writeCondition(user, CONDITION);

      const save = screen.getByTestId("braid-save");
      expect(save).toHaveTextContent("Braid into orchestrator");
      await user.click(save);

      expect(braidsFake.state.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "p-spec",
          readerProjectId: "p-orch",
          where: CONDITION,
        }),
      );
      expect(host.queries.at(-1)).toEqual({ braid: undefined });
      expect(host.successes.at(-1)?.title).toBe("Braid created");
    });

    describe("and the server refuses it", () => {
      it("says the refusal in the drawer and stays open", async () => {
        braidsFake.state.saveError = { code: "braid_already_exists", httpStatus: 409 };
        const { host, user } = openDrawer();
        await pickReader(user);
        await user.click(screen.getByTestId("braid-save"));

        expect(
          screen.getByText("A braid with these terms already goes into this project."),
        ).toBeInTheDocument();
        expect(host.queries).toEqual([]);
      });
    });
  });

  describe("when ana edits a braid into another project", () => {
    it("opens it prefilled with the reader fixed and saves the change", async () => {
      braidsFake.state.project = { intoOtherProjects: [liveBraid()], fromOtherProjects: [] };
      const { user } = openDrawer({ braid: "b-1" });

      expect(screen.getByTestId("braid-condition")).toHaveValue(CONDITION);
      expect(screen.getByTestId("braid-into")).toBeDisabled();
      await user.click(screen.getByTestId("braid-save"));

      expect(braidsFake.state.change).toHaveBeenCalledWith(
        expect.objectContaining({ braidId: "b-1", readerProjectId: "p-orch", where: CONDITION }),
      );
    });
  });
});
