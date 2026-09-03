/**
 * The resource memory a Langy turn carries, so "run it" resolves to an id.
 *
 * Every rule here is about not offering the model a referent that is not one.
 * A tool call that errored created nothing; a digest naming no id refers to
 * nothing; the same resource touched twice is the thing as it now stands, not
 * as it was. Getting any of those wrong hands the agent an id it will then
 * confidently act on.
 *
 * The rendered block is a prompt-injection surface: a resource `name` is
 * whatever a user, an upstream system, or the agent itself called the thing,
 * echoed back into a SYSTEM block. So the block has to say it is data, and the
 * ids in it have to be marked unverified — our say-so is not proof the thing
 * still exists.
 */

import { describe, expect, it } from "vitest";
import type { LangyMessageRow } from "@langwatch/langy-contract";
import { LangyConversationMemoryService } from "../langy-conversation-memory.service";

type Digest = {
  resource: string;
  verb: string;
  strategy?: "id-ref" | "query-ref" | "reduced" | "text";
  ids?: string[];
  primaryId?: string;
  name?: string;
  counts?: { returned?: number; total?: number };
};

/** One assistant turn carrying the tool-call parts it produced. */
const assistantTurn = (
  parts: Array<{ digest?: Digest; state?: string }>,
  id = "message-1",
): LangyMessageRow => ({
  id,
  role: "assistant",
  parts: parts.map((part) => ({
    ...(part.state ? { state: part.state } : {}),
    ...(part.digest ? { digest: { strategy: "id-ref", ...part.digest } } : {}),
  })),
  createdAt: new Date(0),
});

const userTurn = (id = "user-1"): LangyMessageRow => ({
  id,
  role: "user",
  parts: [],
  createdAt: new Date(0),
});

const extract = (messages: LangyMessageRow[], limit?: number) =>
  LangyConversationMemoryService.extract({
    messages,
    ...(limit === undefined ? {} : { limit }),
  });

const scenarioRun = (over: Partial<Digest> = {}): Digest => ({
  resource: "scenario",
  verb: "run",
  primaryId: "scenario-1",
  ...over,
});

describe("LangyConversationMemoryService.extract", () => {
  describe("given an assistant turn that touched a resource", () => {
    it("remembers what it was, what happened to it, and its id", () => {
      expect(extract([assistantTurn([{ digest: scenarioRun() }])])).toEqual([
        { resource: "scenario", verb: "run", turn: 1, ids: ["scenario-1"] },
      ]);
    });

    it("carries the resource's name when the result had one", () => {
      const [entry] = extract([assistantTurn([{ digest: scenarioRun({ name: "Refunds" }) }])]);

      expect(entry).toMatchObject({ name: "Refunds" });
    });

    it("carries the total only when the call returned fewer than it matched", () => {
      const listing = (total: number): Digest => ({
        resource: "trace",
        verb: "list",
        ids: ["trace-1", "trace-2"],
        counts: { total },
      });

      expect(extract([assistantTurn([{ digest: listing(9) }])])[0]).toMatchObject({ total: 9 });
      expect(extract([assistantTurn([{ digest: listing(2) }])])[0]).not.toHaveProperty("total");
    });
  });

  describe("given a call that errored", () => {
    it("remembers nothing from it, because a create that named nothing created nothing", () => {
      expect(extract([assistantTurn([{ digest: scenarioRun(), state: "output-error" }])])).toEqual(
        [],
      );
    });

    it("still remembers the calls beside it that succeeded", () => {
      const entries = extract([
        assistantTurn([
          { digest: scenarioRun({ primaryId: "failed-1" }), state: "output-error" },
          { digest: scenarioRun({ primaryId: "worked-1" }) },
        ]),
      ]);

      expect(entries.map((entry) => entry.ids)).toEqual([["worked-1"]]);
    });
  });

  describe("given a digest that names no id", () => {
    it("remembers nothing, because there is nothing to refer back to", () => {
      expect(
        extract([assistantTurn([{ digest: { resource: "trace", verb: "search", ids: [] } }])]),
      ).toEqual([]);
    });

    it("ignores a part carrying no digest at all", () => {
      expect(extract([assistantTurn([{}])])).toEqual([]);
    });
  });

  describe("given the same resource touched twice", () => {
    it("remembers it once, at the later turn, because 'run it' means as it now stands", () => {
      const entries = extract([
        assistantTurn([{ digest: scenarioRun({ verb: "create" }) }], "m1"),
        assistantTurn([{ digest: scenarioRun({ verb: "run" }) }], "m2"),
      ]);

      expect(entries).toEqual([
        { resource: "scenario", verb: "run", turn: 2, ids: ["scenario-1"] },
      ]);
    });
  });

  describe("given several turns", () => {
    it("answers most recent first", () => {
      const entries = extract([
        assistantTurn([{ digest: scenarioRun({ primaryId: "first" }) }], "m1"),
        assistantTurn([{ digest: scenarioRun({ primaryId: "second" }) }], "m2"),
      ]);

      expect(entries.map((entry) => entry.ids[0])).toEqual(["second", "first"]);
    });

    it("counts the turn ordinal over assistant messages only", () => {
      // "turn 3" has to mean the same thing to the model as it does to the
      // transcript, and a transcript turn is an agent answering.
      const entries = extract([
        userTurn("u1"),
        assistantTurn([{ digest: scenarioRun({ primaryId: "a" }) }], "m1"),
        userTurn("u2"),
        assistantTurn([{ digest: scenarioRun({ primaryId: "b" }) }], "m2"),
      ]);

      expect(entries.map((entry) => entry.turn)).toEqual([2, 1]);
    });

    it("keeps only the most recent up to the limit", () => {
      const turns = ["a", "b", "c"].map((id, index) =>
        assistantTurn([{ digest: scenarioRun({ primaryId: id }) }], `m${index}`),
      );

      expect(extract(turns, 2).map((entry) => entry.ids[0])).toEqual(["c", "b"]);
    });
  });
});

describe("LangyConversationMemoryService.tryRender", () => {
  describe("given nothing was touched", () => {
    it("adds no block at all, rather than an empty one", () => {
      expect(LangyConversationMemoryService.tryRender([])).toBeNull();
    });
  });

  describe("given entries", () => {
    const rendered = () =>
      LangyConversationMemoryService.tryRender(
        extract([assistantTurn([{ digest: scenarioRun({ name: "Refunds" }) }])]),
      ) ?? "";

    it("names the resource, the verb and the id", () => {
      const block = rendered();

      expect(block).toContain("scenario");
      expect(block).toContain("scenario-1");
      expect(block).toContain("Refunds");
    });

    it("tells the model the block is data and the ids are unverified", () => {
      // Without both, a name someone chose becomes an instruction, and an id
      // we merely remember becomes proof the thing still exists.
      const block = rendered().toLowerCase();

      expect(block).toContain("data");
      expect(block).toContain("unverified");
    });
  });
});
