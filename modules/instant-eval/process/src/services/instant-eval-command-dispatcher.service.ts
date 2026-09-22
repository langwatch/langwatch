/**
 * The pipeline's own command senders, which exist only after it is built. Every
 * write this module makes goes through here, so a process that hosts no
 * pipeline refuses by name rather than failing on an undefined sender.
 * @see dev/docs/adr/143-instant-eval-run-is-a-judgment-job.md
 */

import type { InstantEvalOutcomeCommands } from "../eventing/instant-eval-processing.intent.ts";
import type { InstantEvalCancelCommands } from "./instant-eval-cancel.service.ts";
import type { InstantEvalRunCommands } from "./instant-eval-create.service.ts";

type InstantEvalCommandSender = { send(data: unknown): Promise<unknown> };

function isSender(value: unknown): value is InstantEvalCommandSender {
  if (typeof value !== "object" || value === null || !("send" in value)) return false;

  return typeof value.send === "function";
}

export class InstantEvalCommandDispatcherService
  implements InstantEvalRunCommands, InstantEvalCancelCommands
{
  #senders: Readonly<Record<string, unknown>> | null = null;

  private constructor() {}

  static create(): InstantEvalCommandDispatcherService {
    return new InstantEvalCommandDispatcherService();
  }

  /** Binds the built pipeline's senders. Called once, by the eventing module. */
  connect(commands: Readonly<Record<string, unknown>>): void {
    this.#senders = commands;
  }

  requestRun(command: Parameters<InstantEvalRunCommands["requestRun"]>[0]): Promise<unknown> {
    return this.#send("requestRun", command);
  }

  requestCancel(
    command: Parameters<InstantEvalCancelCommands["requestCancel"]>[0],
  ): Promise<unknown> {
    return this.#send("requestCancel", command);
  }

  /** The three the pipeline's own intents record their outcomes through. */
  outcomeCommands(): InstantEvalOutcomeCommands {
    return {
      recordPlanned: (args) => this.#send("recordPlanned", args),
      recordPageJudged: (args) => this.#send("recordPageJudged", args),
      recordFinished: (args) => this.#send("recordFinished", args),
    };
  }

  #send(name: string, data: unknown): Promise<unknown> {
    const sender = this.#senders?.[name];
    if (!isSender(sender)) {
      throw new Error(
        `Instant Evals registered no "${name}" command sender; this process hosts no Instant Eval pipeline.`,
      );
    }

    return sender.send(data);
  }
}
