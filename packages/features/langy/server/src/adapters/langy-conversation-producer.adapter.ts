/**
 * The `langy_conversation_processing` pipeline as a PRODUCER registers it.
 *
 * One definition, two registrations. The consumer — the worker — supplies the
 * two Postgres state folds, the message and analytics projections, the token
 * buffer and turn handoff over its own Redis, the agent manager, the three live
 * subscribers and the turn process manager, and drains every routing key the
 * definition declares. A producer registers the SAME definition only to obtain
 * its command dispatchers: the sixteen writes a conversation is changed by, off
 * a tRPC call, and nothing else. It starts no consumer loop, holds no event
 * log, folds nothing and runs no process manager.
 *
 * Every dependency the definition takes is consumer-side, and a producer has
 * none of them. That is what this module supplies — stand-ins that exist so the
 * definition can be CONSTRUCTED and refuse by name if they are ever CALLED.
 * Refusing rather than no-op'ing is the whole point: a silently-succeeding
 * projection store in a process that was never meant to fold would report a
 * conversation as written when nothing was, and the panel would page through a
 * row that never lands.
 *
 * THE PROCESS MANAGER IS DECLARED HERE AND RUN THERE. This pipeline mounts the
 * turn process manager, and the runtime used to refuse to register any pipeline
 * declaring one without a durable `ProcessStore` — which made all sixteen
 * commands unsendable from the tier a customer's message actually arrives at. A
 * producer-only runtime registers the definition whole and declines the manager
 * by name instead (`EventSourcingOptions.processManagerMode`), so its inbox,
 * outbox and wakes stay the consumer's alone.
 *
 * `connectCommands` is deliberately NOT called on the adapter this builds. The
 * two effects it binds — failing a turn, saving a generated title — are the
 * process manager's, and a producer runs neither; the unbound `Deferred`s refuse
 * by name if one is ever reached, which is the answer a producer wants.
 *
 * Forking the definition instead — declaring only the commands a producer sends
 * — is the thing this avoids. The routing triple every job carries is derived
 * from the pipeline and command names, so two descriptions of one event stream
 * drift into jobs the worker cannot route.
 */
import type { AppendStore, StateProjectionStore } from "@langwatch/eventing";
import type {
  LangyConversationStateData,
  LangyConversationTurnData,
  LangyMessageProjectionRecord,
  LangyTurnAdmissionCapability,
} from "@langwatch/langy-contract";
import type { LangyAnalyticsEventProjectionRecord } from "../projections/langy-analytics-event.projection";
import type { LangyTitleGenerator } from "../ports/langy-effect.port";
import type { LangySessionKeyService } from "../services/langy-session-key.service";
import type { LangyTokenBuffer } from "../streaming/langy-token-buffer";
import type { LangyTurnHandoffStore } from "../streaming/langy-turn-handoff";
import type { LangyBroadcastPort } from "../subscribers/langy-conversation.subscriber";
import { NullLangyWorkerMetricsAdapter } from "./null-langy-worker-metrics.adapter";
import { UnavailableLangyWorkerAdapter } from "./unavailable-langy-worker.adapter";
import { EventingLangyConversationAdapter } from "./eventing.langy-conversation-runtime.adapter";

/** Why every stand-in below refuses, in the process's own words. */
function producerOnly(processName: string, capability: string): Error {
  return new Error(
    `${processName} registered the langy_conversation_processing pipeline as a producer only, so it cannot ${capability}. This work belongs to the worker that drains the pipeline.`,
  );
}

/** A state projection store that cannot fold, because this process consumes nothing. */
class ProducerOnlyStateProjectionStore<TState> implements StateProjectionStore<TState> {
  constructor(
    private readonly processName: string,
    private readonly name: string,
  ) {}

  tryLoad(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, `read the ${this.name} projection`));
  }

  store(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, `write the ${this.name} projection`));
  }
}

/** An append store that cannot append, for the same reason. */
class ProducerOnlyAppendStore<TRow> implements AppendStore<TRow> {
  constructor(
    private readonly processName: string,
    private readonly name: string,
  ) {}

  append(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, `append to the ${this.name} projection`));
  }
}

/**
 * Builds the Langy conversation definition for a process that only sends
 * commands on it.
 *
 * `processName` names the refusal, so a stand-in reached by accident says which
 * process reached it rather than reporting an anonymous failure.
 */
export function createLangyConversationProducerPipeline(input: { processName: string }) {
  const { processName } = input;
  const refuse = (capability: string) => (): Promise<never> =>
    Promise.reject(producerOnly(processName, capability));

  const broadcast: LangyBroadcastPort = {
    broadcastToTenant: refuse("broadcast a conversation update"),
  };
  const admissions: Pick<LangyTurnAdmissionCapability, "confirmAccepted" | "release"> = {
    confirmAccepted: refuse("confirm a turn admission"),
    release: refuse("release a turn admission"),
  };
  const buffer: Pick<LangyTokenBuffer, "liveness" | "appendStatus" | "markError"> = {
    liveness: refuse("read a turn's live buffer"),
    appendStatus: refuse("append a turn status frame"),
    markError: refuse("mark a turn errored"),
  };
  const handoffStore: Pick<LangyTurnHandoffStore, "read" | "stash"> = {
    read: refuse("read a turn handoff"),
    stash: refuse("stash a turn handoff"),
  };
  const sessionKeys: Pick<LangySessionKeyService, "mintForUser" | "revoke"> = {
    mintForUser: refuse("mint a session key"),
    revoke: refuse("revoke a session key"),
  };
  const titleGenerator: LangyTitleGenerator = refuse("generate a conversation title");

  return EventingLangyConversationAdapter.create({
    langyConversationProjectionStore:
      new ProducerOnlyStateProjectionStore<LangyConversationStateData>(
        processName,
        "langy conversation",
      ),
    langyConversationTurnProjectionStore:
      new ProducerOnlyStateProjectionStore<LangyConversationTurnData>(
        processName,
        "langy conversation turn",
      ),
    langyMessageProjectionStore: new ProducerOnlyAppendStore<LangyMessageProjectionRecord>(
      processName,
      "langy message",
    ),
    langyAnalyticsEventProjectionStore:
      new ProducerOnlyAppendStore<LangyAnalyticsEventProjectionRecord>(
        processName,
        "langy analytics event",
      ),
    broadcast,
    admissions,
    buffer,
    handoffStore,
    // The agent manager is dispatched to by the process manager and by the
    // liveness subscriber, both of which are the consumer's. The feature's own
    // unavailable adapter is the honest seat: it answers "not reachable"
    // rather than inventing a dispatch outcome.
    worker: UnavailableLangyWorkerAdapter.create(NullLangyWorkerMetricsAdapter.create()),
    titleGenerator,
    sessionKeys,
  }).buildProcessing();
}
