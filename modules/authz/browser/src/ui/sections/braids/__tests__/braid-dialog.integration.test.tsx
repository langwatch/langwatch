/**
 * @vitest-environment jsdom
 * The New braid and Edit braid dialog, opened from the Braids page by its URL.
 * Spec: modules/authz/specs/braids-screen.feature, "The dialog builds a braid".
 */

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/trace-client", async () => ({
  traceClient: (await import("./braids-api-fake.ts")).braidTraces.traceClient,
}));
vi.mock("@monaco-editor/react", () => import("./monaco-editor-fake.tsx"));
vi.mock("../../../../behavior/authz-api.ts", async () => ({
  authzApi: (await import("./braids-api-fake.ts")).braidsFake.api,
}));

// Isolation is off: reload so the screen binds this file's mocks, not a sibling suite's.
vi.resetModules();
const { braidsFake, braidTraces, liveBraid, previewOf } = await import("./braids-api-fake.ts");
const { FakeAuthzHost, renderWithAuthzHost } = await import("../../../../testing.tsx");
const { default: BraidsScreen } = await import("../braids.screen.tsx");
const { monacoRecorded } = await import("./monaco-editor-fake.tsx");

const STRUCTURE = {
  organizationName: "Acme",
  teams: [{ id: "t-1", name: "Agents" }],
  projects: [
    { id: "p-orch", name: "orchestrator", teamId: "t-1", slug: "orchestrator-x1" },
    { id: "p-spec", name: "specialists", teamId: "t-1", slug: "specialists-x2" },
    { id: "p-roll", name: "rollup", teamId: "t-1", slug: "rollup-x3" },
  ],
};
const CONDITION = 'attributes["orchestrator"] == "web"';

function openDialog({ braid = "new" }: { braid?: string } = {}) {
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

/** The Into picker, named by its field label. */
const intoPicker = () => screen.getByRole("combobox", { name: "Into" });

async function pickReader(user: ReturnType<typeof userEvent.setup>, name = "orchestrator") {
  await user.click(intoPicker());
  const option = screen
    .getAllByTestId("braid-target")
    .find((item) => within(item).queryByText(name));
  if (!option) throw new Error(`${name} is not offered`);
  await user.click(option);
}

async function writeCondition(user: ReturnType<typeof userEvent.setup>, text: string) {
  const editor = await screen.findByTestId("braid-condition");
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
  state.targetsAsked.mockClear();
  state.targetsFail = false;
  state.targetsRefetch.mockClear();
  state.keptToAdmins = false;
  state.viewers = { count: 14, exact: true };
  state.readerSigning = null;
  state.saveError = undefined;
  state.create.mockClear();
  state.change.mockClear();
  braidTraces.state.attributeKeys = [{ key: "orchestrator", spanCount: 4210 }];
  braidTraces.state.preview = previewOf({
    traces: { every: 1200, some: 300, none: 3402, total: 4902, capped: false },
  });
  braidTraces.state.previewAsked.mockClear();
  braidTraces.state.testTraceAsked.mockClear();
});

/** A span of a trace as the trace module's braid reads return it. */
function spanNode(spanId: string, name: string, extra: object = {}) {
  return {
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
  };
}

describe("the braid dialog", () => {
  describe("when ana starts a new braid", () => {
    /** @scenario The braid starts from this project and picks where it goes */
    it("fixes the project it braids from and lists the readable projects, refusing two", async () => {
      const { user } = openDialog();

      expect(
        screen.getByText(
          "Show specialists's spans inside another project's traces. Nothing is copied.",
        ),
      ).toBeInTheDocument();
      const from = screen.getByTestId("braid-from");
      expect(from).toHaveTextContent("specialists");
      expect(within(from).queryByRole("textbox")).toBeNull();
      expect(intoPicker()).toHaveTextContent("Pick a project");
      await user.click(intoPicker());
      expect(screen.getByRole("option", { name: "orchestrator" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "specialists, this project" })).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "rollup, aggregate projects can't be braided" }),
      ).toBeInTheDocument();
      const options = screen.getAllByTestId("braid-target");
      expect(options).toHaveLength(3);
      expect(options[0]).toHaveTextContent("orchestrator");
      expect(options[1]).toHaveTextContent("rollupAggregate projects can't be braided");
      expect(options[2]).toHaveTextContent("specialistsThis project");
      expect(options[0]).not.toHaveAttribute("data-disabled");
      expect(options[1]).toHaveAttribute("data-disabled");
      expect(options[2]).toHaveAttribute("data-disabled");
    });
  });

  describe("when ana picks a reader", () => {
    /** @scenario The braid starts from this project and picks where it goes */
    it("names the Into picker by the picked project", async () => {
      const { user } = openDialog();
      await pickReader(user);

      expect(intoPicker()).toHaveTextContent("orchestrator");
    });
  });

  describe("when the picked reader already has a braid from this project", () => {
    /** @scenario The dialog says what the reader already sees from this project */
    it("lists each braid on the pair with its condition and window in the preview", async () => {
      braidsFake.state.project = {
        intoOtherProjects: [liveBraid({ expiresAtMs: null })],
        fromOtherProjects: [],
      };
      const { user } = openDialog();
      await pickReader(user);

      const pair = screen.getByTestId("braid-pair-braids");
      expect(pair).toHaveTextContent("1 other braid into orchestrator");
      expect(within(pair).queryByTitle(CONDITION)).toBeNull();
      await user.click(within(pair).getByRole("button", { name: "Show" }));
      expect(within(pair).getByTitle(CONDITION)).toBeInTheDocument();
      expect(pair).toHaveTextContent(/From .*2026 · No end date/);
    });

    it("says nothing when the reader has none", async () => {
      const { user } = openDialog();
      await pickReader(user);

      expect(screen.queryByTestId("braid-pair-braids")).toBeNull();
    });

    describe("and ana previews another braid on the same pair", () => {
      /** @scenario A further braid on the same pair says what it adds */
      it("counts what the reader will see with both braids and says how many more spans it shows", async () => {
        braidsFake.state.project = {
          intoOtherProjects: [liveBraid({ expiresAtMs: null })],
          fromOtherProjects: [],
        };
        braidTraces.state.preview = previewOf({
          traces: { every: 1200, some: 300, none: 3402, total: 4902, capped: false },
          spans: 9800,
          live: {
            braids: 1,
            traces: { every: 900, some: 200, none: 3802, total: 4902, capped: false },
            spans: 7400,
          },
        });
        const { user } = openDialog();
        await pickReader(user);
        await writeCondition(user, 'attributes["team"] == "billing"');

        expect(await screen.findByTestId("braid-preview-figure")).toHaveTextContent(
          "1,500 / 4,902",
        );
        expect(screen.getByTestId("braid-preview-added")).toHaveTextContent(
          "Adds 2,400 spans that the other braid doesn't show.",
        );
        expect(braidTraces.state.previewAsked).toHaveBeenLastCalledWith(
          expect.not.objectContaining({ braidId: expect.anything() }),
        );
      });

      it("says when it shows no spans the other braid does not", async () => {
        braidsFake.state.project = {
          intoOtherProjects: [liveBraid({ expiresAtMs: null })],
          fromOtherProjects: [],
        };
        const traces = { every: 1200, some: 300, none: 3402, total: 4902, capped: false };
        braidTraces.state.preview = previewOf({
          traces,
          spans: 7400,
          live: { braids: 1, traces, spans: 7400 },
        });
        const { user } = openDialog();
        await pickReader(user);
        await writeCondition(user, CONDITION);

        expect(await screen.findByTestId("braid-preview-added")).toHaveTextContent(
          "Adds nothing newThe other braid already shows these spans.",
        );
        expect(screen.queryByTestId("braid-preview-figure")).toBeNull();
        expect(screen.getByTestId("braid-preview-counts")).toHaveTextContent(
          "Together they reach 1,500 of 4,902 traces",
        );
      });
    });
  });

  describe("when the viewer cannot read a project's traces", () => {
    /** @scenario A team admin is offered only the projects they can read */
    it("leaves it out and says why", async () => {
      braidsFake.state.targets = [
        { projectId: "p-spec", selectable: false, reason: "this_project" },
      ];
      const { user } = openDialog();

      await user.click(intoPicker());
      expect(screen.queryByText("orchestrator")).not.toBeInTheDocument();
      expect(screen.getByTestId("braid-targets-note")).toHaveTextContent(
        "A braid can only go into a project whose traces you can read.",
      );
    });
  });

  describe("when the organisation holds more projects than the picker asks about", () => {
    /** @scenario The picker asks about at most 500 projects and says when it left some out */
    it("asks about the first 500 and says only those are listed", async () => {
      const projects = Array.from({ length: 501 }, (_, index) => ({
        id: `p-${index}`,
        name: `project ${index}`,
        teamId: "t-1",
        slug: `project-${index}`,
      }));
      const host = new FakeAuthzHost({
        scope: { organizationId: "org-1", projectId: "p-0" },
        grants: new Set(["project:view", "braids:manage"]),
        plan: { isEnterprise: true, isLoading: false },
        query: { braid: "new" },
        structure: { ...STRUCTURE, projects },
      });
      braidsFake.state.targets = projects.slice(0, 500).map((project) => ({
        projectId: project.id,
        selectable: true,
      }));
      renderWithAuthzHost(<BraidsScreen />, host);

      const asked = braidsFake.state.targetsAsked.mock.lastCall?.[0] as { projectIds: string[] };
      expect(asked.projectIds).toHaveLength(500);
      expect(asked.projectIds).not.toContain("p-500");
      expect(screen.getByTestId("braid-targets-limit-note")).toHaveTextContent(
        "Only the first 500 projects of the organisation are listed.",
      );
    });
  });

  describe("when the organisation holds no more projects than the picker asks about", () => {
    /** @scenario The picker asks about at most 500 projects and says when it left some out */
    it("asks about every project and shows no limit note", () => {
      openDialog();

      const asked = braidsFake.state.targetsAsked.mock.lastCall?.[0] as { projectIds: string[] };
      expect(asked.projectIds).toEqual(["p-orch", "p-spec", "p-roll"]);
      expect(screen.queryByTestId("braid-targets-limit-note")).not.toBeInTheDocument();
    });
  });

  describe("when the condition uses an or", () => {
    /** @scenario The condition is checked as it is typed */
    it("marks the or, says how to write it instead and keeps create disabled", async () => {
      const { user } = openDialog();
      await pickReader(user);

      await writeCondition(user, `${CONDITION} or attributes["team"] == "a"`);

      // Marked once typing pauses, never mid-word; Save waits on it meanwhile.
      expect(screen.queryByTestId("braid-condition-check")).toBeNull();
      expect(screen.queryByTestId("braid-preview-refused")).toBeNull();
      expect(screen.getByTestId("braid-save")).toBeDisabled();
      expect(
        await screen.findByTestId("braid-condition-check", {}, { timeout: 2000 }),
      ).toHaveAttribute("role", "alert");
      const orAt = CONDITION.length + 1;
      expect(monacoRecorded.markers).toEqual([
        expect.objectContaining({
          message: expect.stringContaining("isn't supported."),
          startColumn: orAt + 1,
          endColumn: orAt + 3,
        }),
      ]);
      expect(screen.getByTestId("braid-save")).toBeDisabled();

      expect(screen.queryByTestId("braid-viewers")).toBeNull();
      expect(screen.getByTestId("braid-preview-refused")).toBeInTheDocument();

      await writeCondition(user, CONDITION);
      // A supported condition needs no remark.
      expect(screen.queryByTestId("braid-condition-check")).toBeNull();
      expect(screen.getByTestId("braid-save")).toBeEnabled();
    });
  });

  describe("when the condition uses a lone =", () => {
    /** @scenario The condition is checked as it is typed */
    it("answers with the comparison rewritten with ==", async () => {
      const { user } = openDialog();
      await pickReader(user);

      await writeCondition(user, 'attributes["orchestrator"] = "web"');

      expect(
        await screen.findByTestId("braid-condition-check", {}, { timeout: 2000 }),
      ).toHaveTextContent('Use == to compare: attributes["orchestrator"] == "web"');
    });
  });

  describe("when the condition is empty", () => {
    /** @scenario The condition is checked as it is typed */
    it("warns that every span shows only once ana has used the field", async () => {
      const { user } = openDialog();
      await pickReader(user);

      expect(screen.queryByTestId("braid-condition-empty")).toBeNull();
      await user.type(await screen.findByTestId("braid-condition"), "a");
      await user.clear(screen.getByTestId("braid-condition"));

      expect(screen.getByTestId("braid-condition-empty")).toBeInTheDocument();
    });
  });

  describe("when ana opens attributes in the condition", () => {
    /** @scenario Autocomplete offers the owner's attribute keys */
    it("offers the keys the owner's spans carry, most used first, with their span counts", async () => {
      braidTraces.state.attributeKeys = [
        { key: "team", spanCount: 3 },
        { key: "orchestrator", spanCount: 1200 },
      ];
      const { user } = openDialog();
      await writeCondition(user, 'attributes["');
      await waitFor(() => expect(monacoRecorded.provider).toBeDefined());

      const editor = screen.getByTestId<HTMLTextAreaElement>("braid-condition");
      const offered = await waitFor(() => {
        const result = monacoRecorded.provider!.provideCompletionItems(monacoRecorded.model, {
          lineNumber: 1,
          column: editor.value.length + 1,
        }) as { suggestions: { label: string; detail: string }[] };
        expect(result.suggestions).toHaveLength(2);
        return result.suggestions;
      });
      expect(offered.map(({ label, detail }) => [label, detail])).toEqual([
        ["orchestrator", "1,200 spans"],
        ["team", "3 spans"],
      ]);
    });
  });

  describe("when ana presses Escape in the condition", () => {
    it("closes only the suggestion list while it is open, and the dialog after", async () => {
      const { host, user } = openDialog();
      await writeCondition(user, "attributes[");
      const list = document.createElement("div");
      list.className = "suggest-widget visible";
      monacoRecorded.domNode!.append(list);
      monacoRecorded.triggered = [];

      await user.keyboard("{Escape}");
      expect(monacoRecorded.triggered).toEqual(["hideSuggestWidget"]);
      expect(host.queries).toEqual([]);

      list.classList.remove("visible");
      await user.keyboard("{Escape}");
      expect(host.queries).toEqual([expect.objectContaining({ braid: undefined })]);
    });
  });

  describe("when the reader has a signing key in use", () => {
    /** @scenario The signed calls switch and the condition stay in step */
    it("adds and removes Verified with the switch and says nothing of a key in use", async () => {
      braidsFake.state.readerSigning = {
        keyName: "Production",
        lastUsedAt: "2026-10-22T09:00:00Z",
      };
      const { user } = openDialog();
      await pickReader(user);
      await writeCondition(user, CONDITION);

      await user.click(screen.getByRole("checkbox", { name: "Only signed calls" }));
      expect(screen.getByTestId("braid-condition")).toHaveValue(
        `${CONDITION} and Verified("orchestrator")`,
      );
      expect(screen.getByRole("checkbox", { name: "Only signed calls" })).toBeChecked();
      // A key in use is not a problem, so nothing is said about it.
      expect(screen.queryByTestId("braid-signing-key")).not.toBeInTheDocument();

      await writeCondition(user, CONDITION);
      expect(screen.getByRole("checkbox", { name: "Only signed calls" })).not.toBeChecked();
    });
  });

  describe("when the reader's signing key has never signed a call", () => {
    /** @scenario The signed calls switch and the condition stay in step */
    it("warns in one line that nothing shows until the key signs", async () => {
      braidsFake.state.readerSigning = { keyName: "Production", lastUsedAt: null };
      const { user } = openDialog();
      await pickReader(user);

      await user.click(screen.getByRole("checkbox", { name: "Only signed calls" }));
      expect(screen.getByTestId("braid-signing-key")).toHaveTextContent(
        "orchestrator's key “Production” has not signed a call yet",
      );
    });
  });

  describe("when the reader has no signing key and the switch is off", () => {
    it("does not claim nothing will show", async () => {
      const { user } = openDialog();
      await pickReader(user);

      expect(screen.queryByTestId("braid-signing-key")).not.toBeInTheDocument();
    });
  });

  describe("when the project list fails to load", () => {
    it("says so and offers a retry instead of the unreadable-projects note", async () => {
      braidsFake.state.targetsFail = true;
      const { user } = openDialog();

      expect(screen.getByTestId("braid-targets-error")).toBeInTheDocument();
      expect(screen.queryByTestId("braid-targets-note")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Try again" }));
      expect(braidsFake.state.targetsRefetch).toHaveBeenCalled();
    });
  });

  describe("when the organisation keeps braids to its admins", () => {
    it("says only organisation admins can remove a braid", () => {
      braidsFake.state.keptToAdmins = true;
      openDialog();

      expect(
        screen.getByText("Organisation admins can remove a braid at any time."),
      ).toBeInTheDocument();
    });
  });

  describe("when the reader has no signing key", () => {
    /** @scenario Only signed calls offers to set up signing when the reader has no key */
    it("says the reader does not sign yet and where to set it up", async () => {
      const { user } = openDialog();
      await pickReader(user);

      await user.click(screen.getByRole("checkbox", { name: "Only signed calls" }));

      const line = screen.getByTestId("braid-signing-key");
      expect(line).toHaveTextContent("orchestrator doesn't sign its calls yet");
      const create = within(line).getByRole("link", { name: /Create a key/ });
      expect(create).toHaveAttribute("target", "_blank");
      expect(create).toHaveAttribute(
        "href",
        "/orchestrator-x1?return_to=%2Fsettings%2Fbraids%3Fsection%3Dkeys",
      );
      expect(within(line).getByRole("link", { name: "How signing works" })).toBeInTheDocument();
    });
  });

  describe("when ana stops typing a supported condition", () => {
    /** @scenario The preview counts what the reader will see as the condition changes */
    it("counts the reader's traces getting every, some or none, and the unsigned calls", async () => {
      braidTraces.state.preview = previewOf({
        traces: { every: 1200, some: 300, none: 3402, total: 4902, capped: true },
        unsignedHidden: 37,
      });
      const { user } = openDialog();
      await pickReader(user);
      await writeCondition(user, `${CONDITION} and Verified("orchestrator")`);

      const counts = await screen.findByTestId("braid-preview-counts");
      expect(screen.getByTestId("braid-preview-figure")).toHaveTextContent("1,500 / 4,902");
      expect(within(counts).getByTestId("braid-preview-legend")).toHaveTextContent(
        "1,200 every span300 some3,402 none",
      );
      expect(within(counts).getByTitle("Every specialists span shows")).toBeInTheDocument();
      expect(screen.getByTestId("braid-preview-capped")).toBeInTheDocument();
      expect(screen.getByTestId("braid-preview-unsigned")).toHaveTextContent(
        "37 spans had no valid signature and stay hidden.",
      );
      expect(braidTraces.state.previewAsked).toHaveBeenLastCalledWith(
        expect.objectContaining({ projectId: "p-spec", readerProjectId: "p-orch" }),
      );
      expect(screen.queryByTestId("braid-preview-added")).toBeNull();
      expect(screen.queryByTestId("braid-preview-unsigned-hint")).toBeNull();
    });

    /** @scenario The preview counts what the reader will see as the condition changes */
    it("warns once that anyone can set the tag, offering signed calls, and shows an example trace for ana only", async () => {
      braidTraces.state.preview = previewOf({
        traces: { every: 1200, some: 300, none: 3402, total: 4902, capped: false },
        example: {
          traceId: "4bf92f3577b34da6",
          nodes: [
            spanNode("s-1", "handle_message"),
            spanNode("s-2", "payments_agent", { ownerProjectId: "p-spec", braided: true }),
            spanNode("s-3", "fraud_check", { ownerProjectId: "p-spec", braided: false }),
          ],
        },
      });
      const { user } = openDialog();
      await pickReader(user);
      await writeCondition(user, CONDITION);

      const warning = await screen.findByTestId("braid-preview-unsigned-hint");
      expect(warning).toHaveTextContent("Anyone can set this tag");
      await user.click(await screen.findByRole("button", { name: "Show an example trace" }));
      const example = screen.getByTestId("braid-preview-example");
      expect(example).toHaveTextContent("Only you see it.");
      expect(screen.getByTestId("braid-preview-example-summary")).toHaveTextContent(
        "1 span braided in · 1 withheld",
      );
      const spans = within(example).getAllByTestId("braid-example-span");
      expect(spans.map((row) => row.dataset.kind)).toEqual(["own", "braided", "withheld"]);
      expect(spans[2]).toHaveTextContent("fraud_checknot braided");

      await user.click(within(warning).getByRole("button", { name: "Turn on only signed calls" }));
      expect(screen.getByRole("checkbox", { name: "Only signed calls" })).toBeChecked();
      expect(screen.queryByTestId("braid-preview-unsigned-hint")).toBeNull();
    });

    it("shows no example when no trace gets spans", async () => {
      const { user } = openDialog();
      await pickReader(user);
      await writeCondition(user, CONDITION);

      await screen.findByTestId("braid-preview-counts");
      expect(screen.queryByRole("button", { name: "Show an example trace" })).toBeNull();
    });

    it("says the reader has no traces to count instead of counting none of none", async () => {
      braidTraces.state.preview = previewOf({
        traces: { every: 0, some: 0, none: 0, total: 0, capped: false },
      });
      const { user } = openDialog();
      await pickReader(user);
      await writeCondition(user, CONDITION);

      expect(await screen.findByTestId("braid-preview-counts")).toHaveTextContent(
        "orchestrator has no traces in the last 7 days, so there is nothing to count yet.",
      );
    });
  });

  describe("when ana tests a trace id under a refused condition", () => {
    /** @scenario The condition is checked as it is typed */
    it("disables Test with the reason and never asks for the trace", async () => {
      const { user } = openDialog();
      await pickReader(user);
      await writeCondition(user, `${CONDITION} or attributes["team"] == "a"`);
      await user.type(screen.getByRole("textbox", { name: "Trace id" }), "4bf92f3577b34da6");

      const test = screen.getByTestId("braid-test");
      expect(test).toBeDisabled();
      // A disabled button takes no pointer events: the reason sits on a focusable wrapper.
      const reason = screen.getByLabelText("Fix the condition to test a trace.");
      expect(reason).toContainElement(test);
      expect(reason).toHaveAttribute("tabindex", "0");
      expect(test).not.toHaveAttribute("data-loading");
      await user.click(test);
      expect(braidTraces.state.testTraceAsked).not.toHaveBeenCalled();

      await writeCondition(user, CONDITION);
      expect(screen.getByTestId("braid-test")).toBeEnabled();
    });
  });

  describe("when ana tests a trace id", () => {
    /** @scenario A tested trace folds the preview's example trace */
    it("folds the preview's example trace, which ana can open again", async () => {
      const nodes = [
        spanNode("s-1", "handle_message"),
        spanNode("s-2", "payments_agent", { ownerProjectId: "p-spec", braided: true }),
      ];
      braidTraces.state.preview = previewOf({
        traces: { every: 1200, some: 300, none: 3402, total: 4902, capped: false },
        example: { traceId: "4bf92f3577b34da6", nodes },
      });
      braidTraces.state.testTrace = { found: true, nodes };
      const { user } = openDialog();
      await pickReader(user);
      await writeCondition(user, CONDITION);
      expect(screen.queryByTestId("braid-preview-example")).toBeNull();
      await user.click(await screen.findByRole("button", { name: "Show an example trace" }));
      expect(screen.getByTestId("braid-preview-example")).toBeInTheDocument();

      await user.type(screen.getByRole("textbox", { name: "Trace id" }), "4bf92f3577b34da6");
      await user.click(screen.getByTestId("braid-test"));

      expect(await screen.findByTestId("braid-test-trace")).toBeInTheDocument();
      expect(screen.queryByTestId("braid-preview-example")).toBeNull();
      await user.click(screen.getByRole("button", { name: "Show an example trace" }));
      expect(screen.getByTestId("braid-preview-example")).toBeInTheDocument();
    });

    /** @scenario Testing a trace shows it exactly as the reader will see it */
    it("shows the reader's spans, the braided ones with their project and the rest marked not braided", async () => {
      braidTraces.state.testTrace = {
        found: true,
        nodes: [
          spanNode("s-1", "handle_message"),
          spanNode("s-2", "payments_agent", { ownerProjectId: "p-spec", braided: true }),
          spanNode("s-3", "fraud_check", { ownerProjectId: "p-spec", braided: false }),
        ],
      };
      const { user } = openDialog();
      await pickReader(user);

      await user.type(screen.getByRole("textbox", { name: "Trace id" }), "4bf92f3577b34da6");
      await user.click(screen.getByTestId("braid-test"));

      expect(braidTraces.state.testTraceAsked).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ braidId: expect.anything() }),
      );
      const trace = await screen.findByTestId("braid-test-trace");
      expect(trace).toHaveTextContent("Only you see this test; nothing is saved.");
      expect(screen.getByTestId("braid-test-trace-summary")).toHaveTextContent(
        "1 span braided in · 1 withheld",
      );
      const spans = within(trace).getAllByTestId("braid-test-span");
      expect(spans.map((row) => row.dataset.kind)).toEqual(["own", "braided", "withheld"]);
      expect(within(spans[1] as HTMLElement).getByTitle("From specialists")).toBeInTheDocument();
      expect(spans[2]).toHaveTextContent("fraud_checknot braided");
    });
  });

  describe("when ana picks the project to braid into", () => {
    /** @scenario The dialog names how many people will see the spans */
    it("says how many of its members will see the braided spans", async () => {
      const { user } = openDialog();
      await pickReader(user);

      expect(screen.getByTestId("braid-viewers")).toHaveTextContent(
        /14 people\s*in orchestrator will see these spans/,
      );
    });
  });

  describe("when ana completes the braid", () => {
    /** @scenario Creating the braid names the project it goes into */
    it("names the reader on the button, creates it and closes", async () => {
      const { host, user } = openDialog();
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
      it("says the refusal in the dialog and stays open", async () => {
        braidsFake.state.saveError = { code: "braid_already_exists", httpStatus: 409 };
        const { host, user } = openDialog();
        await pickReader(user);
        await user.click(screen.getByTestId("braid-save"));

        expect(
          screen.getByText("A braid with these terms already goes into this project."),
        ).toBeInTheDocument();
        expect(host.queries).toEqual([]);
      });

      it("says the reader holds the most different conditions it can, not that this one is too big", async () => {
        braidsFake.state.saveError = { code: "braid_condition_limit_reached", httpStatus: 422 };
        const { host, user } = openDialog();
        await pickReader(user);
        await user.click(screen.getByTestId("braid-save"));

        expect(
          screen.getByText(
            "The project you're braiding into already receives the most different conditions it can. Reuse a condition one of its braids has, or remove a braid into it.",
          ),
        ).toBeInTheDocument();
        expect(screen.queryByText(/too many comparisons/)).toBeNull();
        expect(host.queries).toEqual([]);
      });
    });
  });

  describe("when ana edits a braid into another project", () => {
    /** @scenario Editing a braid saves only a change */
    it("opens it prefilled with the reader fixed and saves the change", async () => {
      braidsFake.state.project = { intoOtherProjects: [liveBraid()], fromOtherProjects: [] };
      const { user } = openDialog({ braid: "b-1" });

      expect(await screen.findByTestId("braid-condition")).toHaveValue(CONDITION);
      await waitFor(() => expect(screen.getByTestId("braid-condition")).toHaveFocus());
      expect(intoPicker()).toBeDisabled();
      expect(screen.getByTestId("braid-save")).toBeDisabled();

      const changed = `${CONDITION} and attributes["team"] == "billing"`;
      await writeCondition(user, changed);
      await user.click(screen.getByTestId("braid-save"));

      expect(braidsFake.state.change).toHaveBeenCalledWith(
        expect.objectContaining({ braidId: "b-1", readerProjectId: "p-orch", where: changed }),
      );
    });

    /** @scenario Editing a braid saves only a change */
    it("names its fixed reader even when the project list holds no entry for it", () => {
      braidsFake.state.project = { intoOtherProjects: [liveBraid()], fromOtherProjects: [] };
      braidsFake.state.targets = [];
      openDialog({ braid: "b-1" });

      expect(intoPicker()).toHaveTextContent("orchestrator");
      expect(intoPicker()).not.toHaveTextContent("Pick a project");
    });

    /** @scenario Testing a trace shows it exactly as the reader will see it */
    it("tests a trace with the draft in place of the braid it edits", async () => {
      braidsFake.state.project = { intoOtherProjects: [liveBraid()], fromOtherProjects: [] };
      const { user } = openDialog({ braid: "b-1" });

      await user.type(screen.getByRole("textbox", { name: "Trace id" }), "4bf92f3577b34da6");
      await user.click(screen.getByTestId("braid-test"));

      expect(braidTraces.state.testTraceAsked).toHaveBeenLastCalledWith(
        expect.objectContaining({ braidId: "b-1", traceId: "4bf92f3577b34da6" }),
      );
    });

    /** @scenario A further braid on the same pair says what it adds */
    it("asks the preview to count the draft in place of the braid it edits", async () => {
      braidsFake.state.project = { intoOtherProjects: [liveBraid()], fromOtherProjects: [] };
      const { user } = openDialog({ braid: "b-1" });
      await writeCondition(user, `${CONDITION} and attributes["team"] == "billing"`);

      await waitFor(() =>
        expect(braidTraces.state.previewAsked).toHaveBeenLastCalledWith(
          expect.objectContaining({ braidId: "b-1", readerProjectId: "p-orch" }),
        ),
      );
    });
  });
});
