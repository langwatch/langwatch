/**
 * The `gateway_spend_processing` pipeline, registered PRODUCER-ONLY. The Go data plane
 * never writes to a datastore.
 */
import type { EventSourcing } from "@langwatch/eventing";
import {
  GatewaySpendConfirmationPort,
  GatewaySpendProducerAdapter,
  type ConfirmSpendCommandData,
  type GatewaySpendCommandSender,
} from "@langwatch/gateway-server";

const spendProducer = GatewaySpendProducerAdapter.create();
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
 * Registers the definition producer-only and publishes its senders, or reports that this
 * process cannot produce. `undefined` with no queue rather than a set of refusing
 * senders, and that is the difference between two refusals.
 */
export function composeApiGatewaySpendPipeline(
  options: ApiGatewaySpendPipelineOptions,
): ApiGatewaySpendPipeline | undefined {
  const { eventing, processName } = options;
  if (!eventing) {
    options.report?.withoutQueue();
    return undefined;
  }

  const registered = eventing.register(
    spendProducer.createGatewaySpendProducerPipeline({ processName }),
  );
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
 */
const SPEND_PRODUCER_COMMAND_NAMES = ["admitSpend", "confirmSpend", "failSpend"] as const;

/**
 * Reads one sender, FAILING AT BOOT for a command the registration did not produce.
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
