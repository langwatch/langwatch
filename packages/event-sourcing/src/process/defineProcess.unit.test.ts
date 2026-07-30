import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineAggregate } from "../aggregate/defineAggregate";
import { checkTypeStringRatchet } from "../aggregate/ratchet";
import { ConfigurationError } from "../errors";
import { defineProcess } from "./defineProcess";

/**
 * `defineProcess` is the process-manager equivalent of `defineAggregate`
 * (ADR-105 amendment): one curried declaration derives the intent type
 * strings, the payload types, the intent union and its typed creators, and
 * builds one of two process kinds depending on how its wake is armed. These
 * tests are about that derivation, the guards that keep a declaration
 * routable, and the discriminated wake contract that replaces the old
 * runtime's overlapping-optional `nextWakeAt`.
 */

const trigger = defineAggregate("trigger")
  .state(z.object({ matches: z.number() }), () => ({ matches: 0 }))
  .events({
    matchRecorded: {
      data: z.object({ triggerId: z.string(), traceId: z.string() }),
      apply: (s) => ({ ...s, matches: s.matches + 1 }),
    },
    settled: {
      data: z.object({ at: z.number() }),
      apply: (s) => s,
    },
  })
  .build();

const notifyDigestPayload = z.object({
  triggerId: z.string(),
  traceIds: z.array(z.string()),
  boundary: z.number(),
});

const settlementState = z.object({ pending: z.array(z.string()) });

const buildSettlement = () =>
  defineProcess("triggerSettlement")
    .state(settlementState, () => ({ pending: [] }))
    .intents({
      notifyDigest: {
        payload: notifyDigestPayload,
        // Derived purely from the payload — see IntentDef's docblock for why.
        messageKey: (p) =>
          `digest:${p.boundary}:${[...p.traceIds].sort().join(",")}`,
      },
    })
    .on(trigger);

const noopEvolve = (state: { pending: string[] }) => ({
  state,
  intents: [],
  nextWakeAt: null,
});

describe("defineProcess", () => {
  describe("given intents are declared", () => {
    /** @scenario derives a type string per intent, qualified by the process */
    it("derives a type string per intent, qualified by the process", () => {
      const built = buildSettlement().evolve(noopEvolve).build();

      expect(built.intentTypes).toEqual(["triggerSettlement/notifyDigest"]);
    });

    /** @scenario creates an intent carrying the derived type, the declared payload, and a message key computed from that payload */
    it("creates an intent carrying the derived type, the declared payload, and a message key computed from that payload", () => {
      const built = buildSettlement().evolve(noopEvolve).build();

      const intent = built.intents.notifyDigest({
        triggerId: "t1",
        traceIds: ["b", "a"],
        boundary: 1000,
      });

      expect(intent).toEqual({
        intentType: "triggerSettlement/notifyDigest",
        messageKey: "digest:1000:a,b",
        payload: { triggerId: "t1", traceIds: ["b", "a"], boundary: 1000 },
      });
    });

    /** @scenario computes the same message key for a retried intent with the same payload */
    it("computes the same message key for a retried intent with the same payload", () => {
      const built = buildSettlement().evolve(noopEvolve).build();

      const payload = { triggerId: "t1", traceIds: ["a"], boundary: 5 };
      const first = built.intents.notifyDigest(payload);
      const retried = built.intents.notifyDigest({ ...payload });

      expect(retried.messageKey).toBe(first.messageKey);
    });
  });

  describe("given a process is declared against an aggregate's events", () => {
    /** @scenario subscribes to exactly the event types its declared aggregate produces */
    it("subscribes to exactly the event types its declared aggregate produces", () => {
      const built = buildSettlement().evolve(noopEvolve).build();

      expect([...built.eventTypes].sort()).toEqual(
        [...trigger.eventTypes].sort(),
      );
    });

    /** @scenario narrows the incoming event by its declared type inside evolve */
    it("narrows the incoming event by its declared type inside evolve", () => {
      const built = buildSettlement()
        .evolve((state, event) => {
          if (event.type === "trigger/matchRecorded") {
            // Only reachable because narrowing gave `event.data.traceId` a type.
            return {
              state: { pending: [...state.pending, event.data.traceId] },
              intents: [],
              nextWakeAt: null,
            };
          }
          return { state, intents: [], nextWakeAt: null };
        })
        .build();

      const next = built.evolve(
        built.init(),
        trigger.events.matchRecorded({ triggerId: "t1", traceId: "trace-1" }),
        built.intents,
        { at: 0, now: 0, tenantId: "tenant-1", processKey: "t1" },
      );

      expect(next.state.pending).toEqual(["trace-1"]);
    });
  });

  describe("when an evolve-driven process arms and clears its own wake", () => {
    /** @scenario arms a wake by returning the instant it is next due */
    it("arms a wake by returning the instant it is next due", () => {
      const built = buildSettlement()
        .evolve((state, _event, _intents, ctx) => ({
          state,
          intents: [],
          nextWakeAt: ctx.now + 60_000,
        }))
        .build();

      const step = built.evolve(
        built.init(),
        trigger.events.settled({ at: 0 }),
        built.intents,
        { at: 0, now: 1000, tenantId: "tenant-1", processKey: "t1" },
      );

      expect(step.nextWakeAt).toBe(61_000);
    });

    /** @scenario clears a wake by returning null */
    it("clears a wake by returning null", () => {
      const built = buildSettlement().evolve(noopEvolve).build();

      const step = built.evolve(
        built.init(),
        trigger.events.settled({ at: 0 }),
        built.intents,
        { at: 0, now: 0, tenantId: "tenant-1", processKey: "t1" },
      );

      expect(step.nextWakeAt).toBeNull();
    });
  });

  describe("given a fixed-interval process", () => {
    /** @scenario carries no wake instant of its own in its step result */
    it("carries no wake instant of its own in its step result", () => {
      const built = defineProcess("webhookDeliveryPrune")
        .state(z.object({ lastPruneAt: z.number().nullable() }), () => ({
          lastPruneAt: null,
        }))
        .intents({
          prune: {
            payload: z.object({ scheduledFor: z.number() }),
            messageKey: (p) => `prune:${p.scheduledFor}`,
          },
        })
        .schedule({ everyMs: 86_400_000 })
        .onWake((_state, intents, ctx) => ({
          state: { lastPruneAt: ctx.now },
          intents: [intents.prune({ scheduledFor: ctx.now })],
        }))
        .build();

      const step = built.onWake(built.init(), built.intents, {
        at: 0,
        now: 5000,
        tenantId: "tenant-1",
        processKey: "webhookDeliveryPrune",
      });

      expect("nextWakeAt" in step).toBe(false);
      expect(step.state.lastPruneAt).toBe(5000);
    });

    /** @scenario refuses a schedule that is not a positive, finite number of milliseconds */
    it("refuses a schedule that is not a positive, finite number of milliseconds", () => {
      const stated = defineProcess("sweep")
        .state(z.object({}), () => ({}))
        .intents({
          run: { payload: z.object({}), messageKey: () => "run" },
        });

      expect(() => stated.schedule({ everyMs: 0 })).toThrow(ConfigurationError);
      expect(() =>
        stated.schedule({ everyMs: Number.POSITIVE_INFINITY }),
      ).toThrow(ConfigurationError);
    });
  });

  describe("when a declaration would produce an unroutable identity", () => {
    /** @scenario refuses a process name containing the event-type separator */
    it("refuses a process name containing the event-type separator", () => {
      expect(() => defineProcess("bad/name")).toThrow(ConfigurationError);
    });

    /** @scenario refuses an intent key containing the event-type separator */
    it("refuses an intent key containing the event-type separator", () => {
      expect(() =>
        defineProcess("proc")
          .state(z.object({}), () => ({}))
          .intents({
            "bad/key": { payload: z.object({}), messageKey: () => "x" },
          }),
      ).toThrow(ConfigurationError);
    });

    /** @scenario refuses a process that declares no intents */
    it("refuses a process that declares no intents", () => {
      expect(() =>
        defineProcess("proc")
          .state(z.object({}), () => ({}))
          .intents({}),
      ).toThrow(ConfigurationError);
    });
  });

  describe("given intent type strings are persisted the way event type strings are", () => {
    /** @scenario reports an intent type that disappears between snapshots, the same way an event type is */
    it("reports an intent type that disappears between snapshots, the same way an event type is", () => {
      const built = buildSettlement().evolve(noopEvolve).build();

      const snapshot = {
        [built.name]: [...built.intentTypes, "triggerSettlement/persistMatch"],
      };
      const current = { [built.name]: [...built.intentTypes] };

      const violations = checkTypeStringRatchet({ snapshot, current });

      expect(violations).toEqual([
        { aggregate: built.name, missing: ["triggerSettlement/persistMatch"] },
      ]);
    });
  });
});
