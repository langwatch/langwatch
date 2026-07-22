// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useLangyContextTargetStore } from "../stores/langyContextTargetStore";
import { useLangyDevLog } from "../stores/langyDevLog";
import { useLangyStore } from "../stores/langyStore";

/**
 * Nothing Langy holds may follow the user somewhere else.
 *
 * "Somewhere else" is three moves — a different project, a different
 * organization, a different signed-in person — and the whole feature is a set of
 * MODULE SINGLETONS that survive all three (deliberately: the panel and an
 * in-flight answer have to survive navigating between pages). So the boundary is
 * announced rather than inferred, and everything scoped goes at once.
 *
 * The failure this pins is not cosmetic. A trace row clicked in project A stayed
 * in the target store's `picked`, `useLangyPageContext` folded it back into the
 * candidates, and the composer's "+ context" menu offered it in project B —
 * where taking it would have sent another project's resource ref to the agent.
 *
 * Spec: specs/langy/langy-context-awareness.feature
 */

const langy = () => useLangyStore.getState();
const targets = () => useLangyContextTargetStore.getState();
const devLog = () => useLangyDevLog.getState();

const projectATrace = {
  id: "trace:abc123",
  kind: "trace" as const,
  label: "trace abc123",
  ref: "abc123",
};

const scopeA = {
  userId: "user-1",
  organizationId: "org-1",
  projectId: "project-a",
};

/** Put the user in project A with a trace picked and a draft half-typed. */
function workInProjectA(): void {
  langy().resetForScope(scopeA);
  targets().pick(projectATrace);
  langy().chooseChip(projectATrace.id);
  langy().setDraft("what went wrong with");
  langy().setModelOverride("openai/gpt-5-mini");
}

describe("Langy state across a change of scope", () => {
  beforeEach(() => {
    targets().reset();
    useLangyStore.setState({ activeConversationScope: null });
    devLog().clear();
  });

  describe("given a trace was picked in one project", () => {
    describe("when the user moves to another project", () => {
      it("stops offering the other project's trace as context", () => {
        workInProjectA();

        langy().resetForScope({ ...scopeA, projectId: "project-b" });

        expect(targets().picked).toEqual([]);
      });

      it("drops the draft, the chosen chips and the model override with it", () => {
        workInProjectA();

        langy().resetForScope({ ...scopeA, projectId: "project-b" });

        expect(langy().draft).toBe("");
        expect(langy().chosenChipIds.size).toBe(0);
        // A model chosen against one project's configured providers is not a
        // choice about the next project.
        expect(langy().modelOverride).toBe("");
      });
    });

    describe("when the user moves to another organization", () => {
      it("stops offering the other organization's trace as context", () => {
        workInProjectA();

        langy().resetForScope({ ...scopeA, organizationId: "org-2" });

        expect(targets().picked).toEqual([]);
      });
    });

    describe("when somebody else signs in on the same project", () => {
      it("stops offering the previous account's trace as context", () => {
        workInProjectA();

        langy().resetForScope({ ...scopeA, userId: "user-2" });

        expect(targets().picked).toEqual([]);
      });
    });

    describe("when the user starts a new conversation", () => {
      it("stops offering what was gathered for the last one", () => {
        workInProjectA();

        langy().startNewConversation();

        expect(targets().picked).toEqual([]);
      });

      it("leaves the page's registry alone — those rows are still on screen", () => {
        workInProjectA();
        targets().register(projectATrace);

        langy().startNewConversation();

        // Clearing the registry here would empty the `#` palette until the rows
        // happened to remount, which on a static page is never.
        expect(targets().targets[projectATrace.id]).toBeDefined();
      });
    });

    describe("when a question is handed over from the command bar", () => {
      it("stops offering what was gathered before it", () => {
        workInProjectA();

        langy().askLangy("why is this slow?");

        expect(targets().picked).toEqual([]);
      });
    });
  });

  describe("given the developer tape recorded a project's traffic", () => {
    describe("when the scope changes", () => {
      it("empties the tape, so one project's wire is not readable from another", () => {
        langy().resetForScope(scopeA);
        devLog().setRecording(true);
        devLog().record({ type: "delta", text: "secret prompt text" }, "turn-1");
        expect(devLog().records).toHaveLength(1);

        langy().resetForScope({ ...scopeA, projectId: "project-b" });

        expect(devLog().records).toEqual([]);
      });
    });
  });

  describe("given the scope is announced again without changing", () => {
    it("keeps what the user gathered — the same place is not somewhere else", () => {
      // Two callers announce the scope (the layout, which knows all three ids,
      // and the panel, which knows the project). The second must not read as a
      // move.
      workInProjectA();

      langy().resetForScope(scopeA);

      expect(targets().picked.map((t) => t.id)).toEqual([projectATrace.id]);
    });
  });
});

/**
 * The structural claim, and the reason the reset is derived from the store's own
 * shape instead of a hand-written list of fields: a field added tomorrow is
 * cleared tomorrow, without anybody remembering to extend anything.
 *
 * The survivors are re-stated here rather than imported on purpose. Adding state
 * that outlives a change of account should have to be argued for in two places,
 * because the cost of getting it wrong is invisible — one customer's ids quietly
 * offered as context under another's name.
 */
describe("the scope reset's coverage", () => {
  const SURVIVORS = [
    // How this person likes the panel. Not what they were looking at.
    "isOpen",
    "panelMode",
    "panelEffect",
    "devMode",
    "contextHintDismissed",
    // What is mounted right now — a live count, not data.
    "dockShellClaims",
    "dockShifted",
  ];

  describe("given every scoped field has been dirtied", () => {
    describe("when the scope changes", () => {
      it("returns all of them to their initial value", () => {
        const initial = useLangyStore.getInitialState();
        langy().resetForScope(scopeA);
        // Dirty everything reachable through the store's own vocabulary.
        langy().setDraft("half a question");
        langy().setModelOverride("openai/gpt-5-mini");
        langy().chooseChip("trace:abc123");
        langy().attachContext({ type: "trace", id: "abc123", label: "a trace" });
        langy().addSkillChip({ id: "github", label: "GitHub" });
        langy().discardProposal("proposal-1");
        langy().markProposalApplying("proposal-2");
        langy().markProposalApplied("proposal-3", { href: "/somewhere" });
        langy().dismissFeedback("message-1");
        langy().pinFeedback("message-2");
        langy().beginTurn({ conversationId: "conv-1", turnId: "turn-1" });
        langy().setTurnStatus("Searching traces…");
        langy().setTurnProgress(0.5);
        langy().setTurnProgressSample({
          current: 1,
          total: 2,
          receivedAtMs: 0,
        });
        langy().appendTurnReasoning("thinking");
        langy().setTurnPlan([{ content: "look", status: "pending" }]);
        langy().setDevMode(true);
        langy().toggleCardGallery();

        langy().resetForScope({ ...scopeA, projectId: "project-b" });

        const after = useLangyStore.getState() as unknown as Record<
          string,
          unknown
        >;
        const scoped = Object.entries(initial).filter(
          ([key, value]) =>
            typeof value !== "function" && !SURVIVORS.includes(key),
        );
        // The conversation pointer and its fence are the reset's own business
        // (it restores them when the scope turns out to be the one we left).
        const owned = new Set([
          "activeConversationId",
          "historyLoadConversationId",
          "activeConversationScope",
          "conversationEpoch",
        ]);
        for (const [key, initialValue] of scoped) {
          if (owned.has(key)) continue;
          expect({ [key]: after[key] }).toEqual({ [key]: initialValue });
        }
      });

      it("keeps the preferences that are about the person, not the place", () => {
        langy().resetForScope(scopeA);
        langy().setPanelMode("floating");
        langy().setDevMode(true);
        langy().dismissContextHint();
        langy().openPanel();

        langy().resetForScope({ ...scopeA, projectId: "project-b" });

        expect(langy().panelMode).toBe("floating");
        expect(langy().devMode).toBe(true);
        expect(langy().contextHintDismissed).toBe(true);
        expect(langy().isOpen).toBe(true);
      });
    });
  });
});
