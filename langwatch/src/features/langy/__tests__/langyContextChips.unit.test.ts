import { describe, expect, it } from "vitest";
import {
  agentContextChip,
  annotationContextChip,
  automationContextChip,
  dashboardContextChip,
  datasetContextChip,
  evaluationContextChip,
  experimentContextChip,
  mergeContextChips,
  promptContextChip,
  scenarioContextChip,
  shortenChipId,
  traceContextChip,
  workflowContextChip,
} from "../logic/langyContextChips";
import {
  type LangyContextChip,
  selectAddableChips,
  selectVisibleChips,
} from "../stores/langyStore";

/** The chip Langy derives for itself from the open drawer / the route. */
const autoDerivedTrace: LangyContextChip = traceContextChip("abc123def456");

/** The chip the same trace mints when the user clicks its row in the table. */
const pickedTrace: LangyContextChip = traceContextChip("abc123def456");

const pickedEvaluation: LangyContextChip = {
  id: "evaluation:mon_1",
  kind: "evaluation",
  label: "evaluation: latency check",
  ref: "mon_1",
};

const filterChip: LangyContextChip = {
  id: 'filter:status:"error"',
  kind: "filter",
  label: 'filtered: status:"error"',
  ref: 'status:"error"',
};

describe("mergeContextChips", () => {
  describe("given a target the user clicked and one Langy derived on its own", () => {
    describe("when both name the same resource", () => {
      it("collapses them into a single chip", () => {
        const merged = mergeContextChips([autoDerivedTrace, pickedTrace]);

        expect(merged).toHaveLength(1);
        expect(merged[0]!.id).toBe("trace:abc123def456");
      });

      it("keeps the auto-derived chip, which is passed first", () => {
        const routed = { ...autoDerivedTrace, label: "Trace · abc123…56" };
        const clicked = { ...pickedTrace, label: "a worse label" };

        const merged = mergeContextChips([routed, clicked]);

        expect(merged[0]!.label).toBe("Trace · abc123…56");
      });
    });

    describe("when they name different resources", () => {
      it("keeps both, in source order", () => {
        const merged = mergeContextChips([
          autoDerivedTrace,
          filterChip,
          pickedEvaluation,
        ]);

        expect(merged.map((chip) => chip.id)).toEqual([
          "trace:abc123def456",
          'filter:status:"error"',
          "evaluation:mon_1",
        ]);
      });
    });
  });

  describe("given a source that produced nothing", () => {
    describe("when it is merged", () => {
      it("skips the empty slots", () => {
        const merged = mergeContextChips([
          null,
          autoDerivedTrace,
          undefined,
          null,
        ]);

        expect(merged).toEqual([autoDerivedTrace]);
      });
    });
  });

  describe("given the user has chosen nothing", () => {
    describe("when the page has plenty on offer", () => {
      it("puts none of it in the composer", () => {
        // The direction that matters. Being on a page, or having a drawer
        // open, is an OFFER — the model is told about a resource only once
        // someone decided to tell it.
        const candidates = mergeContextChips([
          autoDerivedTrace,
          pickedEvaluation,
        ]);

        expect(selectVisibleChips(candidates, new Set())).toEqual([]);
      });

      it("offers all of it through the '+ context' control", () => {
        const candidates = mergeContextChips([
          autoDerivedTrace,
          pickedEvaluation,
        ]);

        expect(
          selectAddableChips(candidates, new Set()).map((chip) => chip.id),
        ).toEqual(["trace:abc123def456", "evaluation:mon_1"]);
      });
    });
  });

  describe("given the user chose one of them", () => {
    describe("when both are still produced by their sources", () => {
      it("shows the chosen one in the composer", () => {
        const candidates = mergeContextChips([
          autoDerivedTrace,
          pickedEvaluation,
        ]);
        const chosen = new Set(["trace:abc123def456"]);

        expect(
          selectVisibleChips(candidates, chosen).map((chip) => chip.id),
        ).toEqual(["trace:abc123def456"]);
      });

      it("leaves the other one on the '+ context' menu", () => {
        const candidates = mergeContextChips([
          autoDerivedTrace,
          pickedEvaluation,
        ]);
        const chosen = new Set(["trace:abc123def456"]);

        expect(
          selectAddableChips(candidates, chosen).map((chip) => chip.id),
        ).toEqual(["evaluation:mon_1"]);
      });
    });

    describe("when the user drops it again", () => {
      it("hides it, and it stays available to re-add", () => {
        const candidates = mergeContextChips([autoDerivedTrace, pickedTrace]);
        const chosen = new Set<string>();

        expect(selectVisibleChips(candidates, chosen)).toEqual([]);
        expect(
          selectAddableChips(candidates, chosen).map((chip) => chip.id),
        ).toEqual(["trace:abc123def456"]);
      });
    });
  });
});

describe("traceContextChip", () => {
  describe("given a trace id", () => {
    describe("when a row, a drawer and a route each mint a chip for it", () => {
      it("produces an identical chip every time, so the three dedupe", () => {
        expect(traceContextChip("abc123def456")).toEqual({
          id: "trace:abc123def456",
          kind: "trace",
          label: "Trace · abc123…56",
          ref: "abc123def456",
        });
      });
    });
  });

  describe("given a human-readable trace name", () => {
    it("shows the name while keeping the full id as the tool ref", () => {
      expect(traceContextChip("abc123def456", "gen_ai.responses")).toEqual({
        id: "trace:abc123def456",
        kind: "trace",
        label: "Trace · gen_ai.responses",
        ref: "abc123def456",
      });
    });
  });
});

describe("datasetContextChip", () => {
  describe("given a dataset id and its name (a list row)", () => {
    it("mints the chip with the readable name", () => {
      expect(
        datasetContextChip({ datasetId: "ds_12345678", name: "checkout runs" }),
      ).toEqual({
        id: "dataset:ds_12345678",
        kind: "dataset",
        label: "dataset: checkout runs",
        ref: "ds_12345678",
      });
    });
  });

  describe("given only the id (the /datasets/<id> route)", () => {
    it("mints a chip with the SAME id, so row and route dedupe", () => {
      const fromRow = datasetContextChip({
        datasetId: "ds_12345678",
        name: "checkout runs",
      });
      const fromRoute = datasetContextChip({ datasetId: "ds_12345678" });

      expect(fromRoute.id).toBe(fromRow.id);
      expect(fromRoute.label).toBe("dataset ds_123…78");
    });
  });
});

describe("promptContextChip", () => {
  describe("given a prompt with a handle", () => {
    it("labels and refs by the handle — the name the agent's tools resolve", () => {
      expect(
        promptContextChip({ promptId: "prompt_123456", handle: "billing/tone" }),
      ).toEqual({
        id: "prompt:prompt_123456",
        kind: "prompt",
        label: "prompt: billing/tone",
        ref: "billing/tone",
      });
    });
  });

  describe("given a prompt with no handle", () => {
    it("falls back to the shortened id for both", () => {
      expect(
        promptContextChip({ promptId: "prompt_123456", handle: null }),
      ).toEqual({
        id: "prompt:prompt_123456",
        kind: "prompt",
        label: "prompt prompt…56",
        ref: "prompt_123456",
      });
    });
  });

  describe("given the prompt editor drawer minted a chip for the same prompt", () => {
    it("shares the drawer's id key, so the two dedupe", () => {
      // The drawer derives `prompt:<drawer.promptId>` (see useLangyDrawerContext).
      expect(promptContextChip({ promptId: "prompt_123456" }).id).toBe(
        "prompt:prompt_123456",
      );
    });
  });
});

describe("the resource chip factories", () => {
  describe("given a card on a list page that knows the resource's name", () => {
    it("leads with the name a person recognises, not the id", () => {
      expect(
        workflowContextChip({ workflowId: "wf_123456789", name: "checkout" })
          .label,
      ).toBe("workflow: checkout");
      expect(
        agentContextChip({ agentId: "ag_123456789", name: "triage bot" }).label,
      ).toBe("agent: triage bot");
      expect(
        dashboardContextChip({ dashboardId: "db_123456789", name: "costs" })
          .label,
      ).toBe("dashboard: costs");
    });

    it("still sends the id to the agent, where an id is what is wanted", () => {
      expect(
        agentContextChip({ agentId: "ag_123456789", name: "triage bot" }).ref,
      ).toBe("ag_123456789");
    });
  });

  describe("given a resource with no name to show", () => {
    it("falls back to a shortened id rather than an empty label", () => {
      expect(automationContextChip({ automationId: "au_123456789" }).label).toBe(
        "automation au_123…89",
      );
      expect(
        workflowContextChip({ workflowId: "wf_123456789", name: "  " }).label,
      ).toBe("workflow wf_123…89");
    });
  });

  describe("given the same resource is also named by the URL", () => {
    // `useLangyPageContext.routeChips` builds `<kind>:<ref>` straight from the
    // path. A card that mints a different key would put the same thing in the
    // composer twice — once from the click, once from the route.
    it("shares the route-derived chip id, so the two dedupe into one", () => {
      expect(
        workflowContextChip({ workflowId: "wf_1", name: "checkout" }).id,
      ).toBe("workflow:wf_1");
      expect(agentContextChip({ agentId: "ag_1", name: "bot" }).id).toBe(
        "agent:ag_1",
      );
      expect(
        automationContextChip({ automationId: "au_1", name: "alert" }).id,
      ).toBe("automation:au_1");
      // Annotation queues live at `/annotations/<slug>`, so the chip is keyed
      // on the slug — not the queue's database id.
      expect(
        annotationContextChip({ annotationId: "triage", name: "Triage" }).id,
      ).toBe("annotation:triage");
      // Experiments live at `/experiments/<slug>`, for the same reason.
      expect(experimentContextChip({ slug: "run-42", name: "Run 42" }).id).toBe(
        "experiment:run-42",
      );
      expect(
        evaluationContextChip({ evaluationId: "ev_1", name: "latency" }).id,
      ).toBe("evaluation:ev_1");
      expect(
        scenarioContextChip({ scenarioId: "sr_1", name: "checkout" }).id,
      ).toBe("scenario:sr_1");
      expect(
        dashboardContextChip({ dashboardId: "db_1", name: "costs" }).id,
      ).toBe("dashboard:db_1");
    });
  });

  describe("given a surface that words its resource differently", () => {
    it("says the noun the page says, while keeping the shared kind", () => {
      const evaluator = evaluationContextChip({
        evaluationId: "ev_1",
        name: "latency",
        noun: "evaluator",
      });

      expect(evaluator.label).toBe("evaluator: latency");
      // Same kind as an online evaluation, so the agent resolves both the same
      // way and the two dedupe when they name one resource.
      expect(evaluator.kind).toBe("evaluation");
    });
  });
});

describe("shortenChipId", () => {
  describe("given a long id", () => {
    describe("when it is put on a chip", () => {
      it("elides the middle", () => {
        expect(shortenChipId("abc123def456")).toBe("abc123…56");
      });
    });
  });

  describe("given a short id", () => {
    describe("when it is put on a chip", () => {
      it("leaves it whole", () => {
        expect(shortenChipId("abc123")).toBe("abc123");
      });
    });
  });
});
