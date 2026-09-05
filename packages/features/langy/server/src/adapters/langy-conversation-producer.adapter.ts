/**
 * The `langy_conversation_processing` pipeline as a PRODUCER registers it. One definition, two
 * registrations.
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
import type { LangyTokenBuffer } from "./redis.langy-token-buffer.adapter";
import type { LangyTurnHandoffStore } from "./redis.langy-turn-handoff.adapter";
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
 * Builds the Langy conversation definition for a process that only sends commands on it.
 * `processName` names the refusal, so a stand-in reached by accident says which process reached it
 * rather than reporting an anonymous failure.
 */
function buildLangyConversationProducerPipeline(input: { processName: string }) {
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

/** The Langy conversation definition as a command-only producer sees it. */
export class LangyConversationProducerAdapter {
  static create(options: { processName: string }): LangyConversationProducerAdapter {
    return new LangyConversationProducerAdapter(options);
  }

  private constructor(private readonly options: { processName: string }) {}

  build() {
    return buildLangyConversationProducerPipeline(this.options);
  }
}
