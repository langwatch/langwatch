import {
  IDENTITY_PIPELINE_NAME,
  JOIN_REQUEST_PIPELINE_NAME,
  SSO_CONNECTION_PIPELINE_NAME,
} from "@langwatch/identity-contract";

import { SENDER_NAME_BY_COMMAND } from "./sso-connection-ledger.store.ts";

/** One pipeline command's sender, or that this process registered none for it. */
export type IdentityPipelineCommand =
  | { kind: "registered"; sender: { send(data: unknown): Promise<unknown> } }
  | { kind: "unregistered" };

/**
 * The event-sourcing stack an identity ledger STAGES through. ONE method, by
 * doctrine (ADR-110): the queued run is the sole appender, so appending here
 * too would double-write every fact.
 */
export interface IdentityEventing {
  resolvePipelineCommand(input: {
    pipeline: string;
    command: string;
  }): Promise<IdentityPipelineCommand>;
}

/** The one shape a command dispatcher has, checked rather than asserted. */
type IdentityCommandSender = { send(data: unknown): Promise<unknown> };

const isSender = (value: unknown): value is IdentityCommandSender =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as IdentityCommandSender).send === "function";

/**
 * Reads one registration's senders, FAILING AT BOOT for a command it did not produce.
 */
function resolveSenders(input: {
  pipeline: string;
  registered: { commands: unknown };
  expected: readonly string[];
}): Map<string, IdentityCommandSender> {
  const commands = input.registered.commands as Record<string, unknown>;
  const resolved = new Map<string, IdentityCommandSender>();
  for (const name of input.expected) {
    const sender = commands[name];
    if (!isSender(sender)) {
      throw new Error(
        `The ${input.pipeline} registration produced no "${name}" command sender; the pipeline was registered incompletely.`,
      );
    }
    resolved.set(name, sender);
  }
  return resolved;
}

/**
 * The fifteen identity verbs, listed once. A list rather than a trusted read of whatever
 * the registration happened to expose, so a command REMOVED from the packaged definition
 * fails this process's boot rather than one person's sign-in ceremony.
 */
const IDENTITY_COMMAND_NAMES = [
  "attachIdentifier",
  "verifyIdentifier",
  "markPrimary",
  "detachIdentifier",
  "eraseUser",
  "proposeLink",
  "confirmLink",
  "rejectLink",
  "enrollMfa",
  "confirmMfa",
  "expireMfaEnrollment",
  "disableMfa",
  "consumeBackupCode",
  "regenerateBackupCodes",
  "recordMfaVerificationFailure",
] as const;

/** The five verbs a join request has. `expireJoin` is the lifecycle's own. */
const JOIN_REQUEST_COMMAND_NAMES = [
  "requestJoin",
  "approveJoin",
  "rejectJoin",
  "withdrawJoin",
  "expireJoin",
] as const;

/** Every verb a connection has: each one its ledger can stage (sso-activation.feature). */
const SSO_CONNECTION_COMMAND_NAMES: readonly string[] = Object.values(SENDER_NAME_BY_COMMAND);

/** The three pipelines and the verbs each one is expected to publish. */
const EXPECTED_COMMANDS: ReadonlyMap<string, readonly string[]> = new Map<
  string,
  readonly string[]
>([
  [IDENTITY_PIPELINE_NAME, IDENTITY_COMMAND_NAMES],
  [JOIN_REQUEST_PIPELINE_NAME, JOIN_REQUEST_COMMAND_NAMES],
  [SSO_CONNECTION_PIPELINE_NAME, SSO_CONNECTION_COMMAND_NAMES],
]);

/**
 * Identity's command senders, handed over by each of its three eventing modules as the process
 * connects them. A pipeline not yet connected answers null: not commandable on this process.
 */
export class ConnectedIdentityEventing implements IdentityEventing {
  static create(): ConnectedIdentityEventing {
    return new ConnectedIdentityEventing();
  }

  readonly #senders = new Map<string, Map<string, IdentityCommandSender>>();

  private constructor() {}

  /** Fails the install by name when a registration produced some of identity's verbs, not all. */
  connect(input: { pipeline: string; commands: object }): void {
    // A runtime with no command queue hands over no senders at all: nothing is commandable here.
    if (Object.keys(input.commands).length === 0) return;
    this.#senders.set(
      input.pipeline,
      resolveSenders({
        pipeline: input.pipeline,
        registered: { commands: input.commands },
        expected: EXPECTED_COMMANDS.get(input.pipeline) ?? [],
      }),
    );
  }

  async resolvePipelineCommand(input: {
    pipeline: string;
    command: string;
  }): Promise<IdentityPipelineCommand> {
    const sender = this.#senders.get(input.pipeline)?.get(input.command);
    return sender ? { kind: "registered", sender } : { kind: "unregistered" };
  }
}
