/**
 * @vitest-environment node
 *
 * A process manager's generated subscriber is NOT killable, and this is where
 * that is decided.
 *
 * The runtime mounts every process manager as an ordinary `pm:*` event
 * subscriber, so it arrives at the same fan-out seam as a hand-declared one.
 * `ProcessManagerEnqueueOptions` states that `disabled` / `killSwitch` are
 * deliberately not offered to a process manager — a killed subscriber drops
 * events, and a process manager's events are durable work with a deadline
 * behind them, retried by nothing and reconciled by nothing afterwards.
 *
 * That was true of what a definition could DECLARE and false of what the seam
 * DID: `isComponentDisabled` derives a flag key when none is supplied, so
 * `es-<aggregate>-subscriber-pm:<name>-killswitch` was a live switch over
 * durable work. It could not be flipped from the Ops feature-flags page —
 * `getKillSwitchDescriptors` never emitted it and `ops.setFeatureFlag` refuses
 * an unknown key — but the flag store and the force-enable env reach it
 * regardless, which made it droppable AND invisible.
 *
 * @see specs/event-sourcing/payload-cost.feature
 */
import { describe, expect, it } from "vitest";

import type { Event } from "../../domain/types";
import {
  createTestAggregateType,
  createTestEvent,
  createTestEventStoreReadContext,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import { QueueManager } from "../../services/queues/queueManager";
import { ProjectionRouter } from "../projectionRouter";

const aggregateType = createTestAggregateType();
const tenantId = createTestTenantId();
const readContext = createTestEventStoreReadContext(tenantId);

function makeEvent(id: string): Event {
  return createTestEvent(
    TEST_CONSTANTS.AGGREGATE_ID,
    aggregateType,
    tenantId,
    TEST_CONSTANTS.EVENT_TYPE_1,
    1000,
    "2025-12-17",
    { marker: id },
    id,
  );
}

/**
 * A flag service that answers "disabled" to everything and records what it was
 * asked. Blanket-true is the point: any switch the seam consults at all is
 * flipped, so a subscriber that still runs is one whose switch was never
 * consulted rather than one that happened to resolve false.
 */
function makeEverythingKilledFlagService() {
  const asked: string[] = [];
  return {
    asked,
    service: {
      isEnabled: async (key: string): Promise<boolean> => {
        asked.push(key);
        return true;
      },
    } as never,
  };
}

describe("process-manager subscribers at the fan-out seam", () => {
  describe("given every kill switch the seam consults is flipped", () => {
    describe("when a process manager's subscriber and a hand-declared one both match the event", () => {
      /** @scenario durable process work has no stop switch to reach for */
      it("keeps handing the process manager its durable work while the ordinary subscriber stops", async () => {
        const flags = makeEverythingKilledFlagService();
        const processManagerReceived: string[] = [];
        const ordinaryReceived: string[] = [];

        const router = new ProjectionRouter<Event>(
          aggregateType,
          TEST_CONSTANTS.PIPELINE_NAME,
          // No global queue, so the router runs subscribers inline: the kill
          // switch still resolves at the same seam, and what a subscriber
          // received is directly observable.
          new QueueManager<Event>({
            aggregateType,
            pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
          }),
          flags.service,
        );
        router.registerEventSubscriber({
          name: "pm:webhookDeliveryPrune",
          eventTypes: [],
          handle: async (event) => {
            processManagerReceived.push(event.id);
          },
        });
        router.registerEventSubscriber({
          name: "ordinarySubscriber",
          eventTypes: [],
          handle: async (event) => {
            ordinaryReceived.push(event.id);
          },
        });

        await router.dispatch([makeEvent("evt-1")], readContext);

        expect(processManagerReceived).toEqual(["evt-1"]);
        expect(ordinaryReceived).toEqual([]);
      });

      /**
       * Asked-for keys, not just outcomes: a seam that resolved the switch and
       * ignored the answer would pass the test above while still paying for a
       * flag lookup per tenant on the durable path — and would come back the
       * moment someone "simplified" the ignored branch away.
       */
      it("never resolves a kill switch for the process manager's subscriber", async () => {
        const flags = makeEverythingKilledFlagService();
        const router = new ProjectionRouter<Event>(
          aggregateType,
          TEST_CONSTANTS.PIPELINE_NAME,
          new QueueManager<Event>({
            aggregateType,
            pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
          }),
          flags.service,
        );
        router.registerEventSubscriber({
          name: "pm:webhookDeliveryPrune",
          eventTypes: [],
          handle: async () => {},
        });
        router.registerEventSubscriber({
          name: "ordinarySubscriber",
          eventTypes: [],
          handle: async () => {},
        });

        await router.dispatch([makeEvent("evt-1")], readContext);

        expect(flags.asked).toEqual([
          `es-${aggregateType}-subscriber-ordinarySubscriber-killswitch`,
        ]);
      });
    });
  });
});
