/**
 * The `gateway_spend_processing` pipeline, registered PRODUCER-ONLY.
 *
 * The Go data plane never writes to a datastore. Every gateway request it
 * serves becomes three spooled commands — `admitSpend` before the provider is
 * dispatched, then `confirmSpend` or `failSpend` after it answers — and its
 * drainer posts them in batches to `/api/internal/gateway/spend-commands`.
 * Until this registration existed that route answered 503
 * `spend_pipeline_disabled`, so a deployment serving the data plane from
 * `apps/api` spooled its billing records forever and re-posted them until the
 * gateway's own buffer dropped them.
 *
 * ## Why the registration is its own module rather than a line in the door
 *
 * Two doors produce on this pipeline and neither owns it. The internal REST
 * family dispatches the drained batch, and the realtime voice settlement
 * confirms one brokered session's usage; both have to reach the SAME
 * registration, because two registrations of one pipeline on one process would
 * be two queue producers writing the same routing key with two different
 * command dispatchers behind them. Composing it here and handing both doors
 * the result is what makes that unexpressible.
 *
 * It sits beside the door rather than in `api-agent-pipelines.composition.ts`
 * for the reason the OTLP receiver's own registration does
 * (`api-trace-ingest.composition.ts`): that file is the three AGENT-side
 * pipelines a customer's action writes on, and spend is money the data plane
 * reports, on a definition whose consumer-side half is two process managers
 * this process must never mount.
 *
 * ## What a producer is registered WITHOUT, and why it matters here
 *
 * `createGatewaySpendProducerPipeline` declares no process manager at all. The
 * definition the worker registers carries three — the ADR-073 webhook
 * delivery, the Governance debits and the settlement sweeper — and the first
 * two write a customer's money and ship their webhooks. Registering them here
 * would put this process in the drain path for the shared queue: it would
 * claim jobs the worker is sized and scheduled to run. The runtime's
 * `processManagerMode: "producer-only"` declines them by name, but a
 * definition that declares none cannot be registered wrongly at all.
 *
 * `settleSpend` is deliberately not published below. It is the sweeper's own
 * command, sent by the process manager that resolves an admission whose
 * confirmation never arrived; offering it from this tier would be a write no
 * door here has a reason to make.
 */
import type { EventSourcing } from "@langwatch/eventing";
import {
  createGatewaySpendProducerPipeline,
  GatewaySpendConfirmationPort,
  type ConfirmSpendCommandData,
  type GatewaySpendCommandSender,
} from "@langwatch/gateway-server";

/** Reports the composition decision an absent queue would otherwise hide. */
export abstract class ApiGatewaySpendPipelineAbsenceReport {
  /** No Eventing: `/spend-commands` refuses and the data plane keeps spooling. */
  abstract withoutQueue(): void;
}

export type ApiGatewaySpendPipelineOptions = Readonly<{
  /**
   * The producer-only Eventing runtime the definition is registered on, or
   * `undefined` where this process composed no queue.
   */
  eventing: EventSourcing | undefined;
  /** Names this process in the producer stand-in's refusals. */
  processName: string;
  report?: ApiGatewaySpendPipelineAbsenceReport;
}>;

/** The spend write surface, as this process produces it. */
export type ApiGatewaySpendPipeline = Readonly<{
  /**
   * The three commands the data plane's drained batch becomes, by the names
   * the internal family looks them up under.
   */
  commands: Record<string, GatewaySpendCommandSender | undefined>;
  /** The voice settlement's one write, as the realtime session service holds it. */
  confirmation: GatewaySpendConfirmationPort;
}>;

/**
 * Registers the definition producer-only and publishes its senders, or reports
 * that this process cannot produce.
 *
 * `undefined` with no queue rather than a set of refusing senders, and that is
 * the difference between two refusals. A door handed refusing senders answers
 * 500 per record after validating the batch; a door handed nothing answers 503
 * `spend_pipeline_disabled` at the top, which is the code the data plane's
 * drainer already spools against — so the batch is retried rather than acked
 * and lost.
 */
export function composeApiGatewaySpendPipeline(
  options: ApiGatewaySpendPipelineOptions,
): ApiGatewaySpendPipeline | undefined {
  const { eventing, processName } = options;
  if (!eventing) {
    options.report?.withoutQueue();
    return undefined;
  }

  const registered = eventing.register(createGatewaySpendProducerPipeline({ processName }));
  const commands = registered.commands as Record<string, GatewaySpendCommandSender | undefined>;

  return {
    commands: Object.fromEntries(
      SPEND_PRODUCER_COMMAND_NAMES.map((name) => [name, commands[name]]),
    ),
    confirmation: EventingApiGatewaySpendConfirmation.create(
      requireSender({ commands, name: "confirmSpend" }),
    ),
  };
}

/**
 * The three names this tier produces, listed once.
 *
 * A list rather than handing the registration's whole `commands` object over,
 * so a command the pipeline gains later cannot silently become a write the
 * data plane's door will dispatch without anyone deciding it should.
 */
const SPEND_PRODUCER_COMMAND_NAMES = ["admitSpend", "confirmSpend", "failSpend"] as const;

/**
 * Reads one sender, FAILING AT BOOT for a command the registration did not
 * produce.
 *
 * The voice settlement is the caller that cannot degrade: a session is booked
 * on the promise that its usage will be reported, so a missing `confirmSpend`
 * has to be found at boot rather than after a customer's call has already run.
 */
function requireSender(input: {
  commands: Record<string, GatewaySpendCommandSender | undefined>;
  name: string;
}): GatewaySpendCommandSender {
  const sender = input.commands[input.name];
  if (!sender) {
    throw new Error(
      `The gateway_spend_processing registration produced no "${input.name}" command sender; the pipeline was registered incompletely.`,
    );
  }
  return sender;
}

/** The voice settlement's confirmation, on this process's own registration. */
class EventingApiGatewaySpendConfirmation extends GatewaySpendConfirmationPort {
  static create(sender: GatewaySpendCommandSender): EventingApiGatewaySpendConfirmation {
    return new EventingApiGatewaySpendConfirmation(sender);
  }

  private constructor(private readonly sender: GatewaySpendCommandSender) {
    super();
  }

  async confirmSpend(data: ConfirmSpendCommandData): Promise<void> {
    await this.sender.send(data);
  }
}
