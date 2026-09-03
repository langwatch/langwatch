import {
  ACTIVATE_CONNECTION_COMMAND_TYPE,
  type ActivateConnectionCommandData,
  APPROVE_DOMAIN_CLAIM_COMMAND_TYPE,
  type ApproveDomainClaimCommandData,
  ATTEST_DOMAIN_COMMAND_TYPE,
  type AttestDomainCommandData,
  activateConnectionCommandDataSchema,
  approveDomainClaimCommandDataSchema,
  attestDomainCommandDataSchema,
  CLAIM_DOMAIN_COMMAND_TYPE,
  type ClaimDomainCommandData,
  COMPLETE_TEARDOWN_COMMAND_TYPE,
  type CompleteTeardownCommandData,
  claimDomainCommandDataSchema,
  completeTeardownCommandDataSchema,
  DISCARD_CONNECTION_COMMAND_TYPE,
  type DiscardConnectionCommandData,
  discardConnectionCommandDataSchema,
  GRANDFATHER_CONNECTION_COMMAND_TYPE,
  type GrandfatherConnectionCommandData,
  grandfatherConnectionCommandDataSchema,
  REGISTER_CONNECTION_COMMAND_TYPE,
  REJECT_DOMAIN_CLAIM_COMMAND_TYPE,
  REQUEST_TEARDOWN_COMMAND_TYPE,
  REQUEST_VERIFICATION_COMMAND_TYPE,
  RESUME_CONNECTION_COMMAND_TYPE,
  type RegisterConnectionCommandData,
  type RejectDomainClaimCommandData,
  type RequestTeardownCommandData,
  type RequestVerificationCommandData,
  type ResumeConnectionCommandData,
  registerConnectionCommandDataSchema,
  rejectDomainClaimCommandDataSchema,
  requestTeardownCommandDataSchema,
  requestVerificationCommandDataSchema,
  resumeConnectionCommandDataSchema,
  type SsoConnectionCommand,
  SUSPEND_CONNECTION_COMMAND_TYPE,
  type SuspendConnectionCommandData,
  suspendConnectionCommandDataSchema,
  VERIFY_DOMAIN_COMMAND_TYPE,
  type VerifyDomainCommandData,
  verifyDomainCommandDataSchema,
} from "@langwatch/identity-contract";
import type { SsoConnectionGuards } from "../sso-connection-guards";
import type { ZodTypeAny, z } from "zod";
import {
  type Command,
  type CommandHandler,
  defineCommandSchema,
} from "@langwatch/eventing";
import { ssoConnectionEventsFor } from "../projections/sso-connection-state.projection";
import type { SsoConnectionEvent } from "../projections/sso-connection-state.projection";

/**
 * The connection pipeline's thirteen verbs plus grandfathering, as the queue's
 * STAGED RE-RUN of each: the same guard the calling path ran, the same
 * envelope. A retried command carries the same commandId, so the re-run
 * costs no second event.
 *
 * Every one is the identical move, so it is written once here rather than
 * thirteen times across thirteen files — the authz pipeline's
 * `grantsLedgerCommands.ts` shape, for the same reason.
 */

type GuardVerb = {
  [K in keyof SsoConnectionGuards]: SsoConnectionGuards[K] extends (
    data: never,
  ) => Promise<unknown>
    ? K
    : never;
}[keyof SsoConnectionGuards];

function connectionCommand<Schema extends ZodTypeAny>({
  type,
  schema,
  description,
  verb,
}: {
  type: SsoConnectionCommand["type"];
  schema: Schema;
  description: string;
  verb: GuardVerb;
}) {
  type Data = z.infer<Schema>;
  return class SsoConnectionCommandHandler
    implements CommandHandler<Command<Data>, SsoConnectionEvent>
  {
    static readonly schema = defineCommandSchema(type, schema, description);

    /** The CONNECTION is the aggregate — never the organization. One
     *  connection's commands share a lane; two connections never do. */
    static getAggregateId(payload: { connectionId: string }): string {
      return payload.connectionId;
    }

    constructor(private readonly guards: SsoConnectionGuards) {}

    async handle(command: Command<Data>): Promise<SsoConnectionEvent[]> {
      const data = command.data as never;
      const facts = await (
        this.guards[verb] as (input: never) => Promise<never[]>
      )(data);
      return ssoConnectionEventsFor({
        command: { type, data } as SsoConnectionCommand,
        facts,
      });
    }
  };
}

export const RegisterConnectionCommand = connectionCommand({
  type: REGISTER_CONNECTION_COMMAND_TYPE,
  schema: registerConnectionCommandDataSchema,
  description: "Start an organization's SSO connection as a draft",
  verb: "registerConnection",
});
export type RegisterConnectionPayload = RegisterConnectionCommandData;

export const ClaimDomainCommand = connectionCommand({
  type: CLAIM_DOMAIN_COMMAND_TYPE,
  schema: claimDomainCommandDataSchema,
  description: "Claim an email domain for a connection, pending ops approval",
  verb: "claimDomain",
});
export type ClaimDomainPayload = ClaimDomainCommandData;

export const ApproveDomainClaimCommand = connectionCommand({
  type: APPROVE_DOMAIN_CLAIM_COMMAND_TYPE,
  schema: approveDomainClaimCommandDataSchema,
  description: "Record an operator approving a domain claim",
  verb: "approveDomainClaim",
});
export type ApproveDomainClaimPayload = ApproveDomainClaimCommandData;

export const RejectDomainClaimCommand = connectionCommand({
  type: REJECT_DOMAIN_CLAIM_COMMAND_TYPE,
  schema: rejectDomainClaimCommandDataSchema,
  description: "Record an operator rejecting a domain claim, with the note",
  verb: "rejectDomainClaim",
});
export type RejectDomainClaimPayload = RejectDomainClaimCommandData;

export const DiscardConnectionCommand = connectionCommand({
  type: DISCARD_CONNECTION_COMMAND_TYPE,
  schema: discardConnectionCommandDataSchema,
  description: "Abandon a draft connection",
  verb: "discardConnection",
});
export type DiscardConnectionPayload = DiscardConnectionCommandData;

export const RequestVerificationCommand = connectionCommand({
  type: REQUEST_VERIFICATION_COMMAND_TYPE,
  schema: requestVerificationCommandDataSchema,
  description: "Open a domain ownership ceremony, recording the proof's hash",
  verb: "requestVerification",
});
export type RequestVerificationPayload = RequestVerificationCommandData;

export const AttestDomainCommand = connectionCommand({
  type: ATTEST_DOMAIN_COMMAND_TYPE,
  schema: attestDomainCommandDataSchema,
  description:
    "Record a platform operator attesting that a domain is the organization's",
  verb: "attestDomain",
});
export type AttestDomainPayload = AttestDomainCommandData;

export const VerifyDomainCommand = connectionCommand({
  type: VERIFY_DOMAIN_COMMAND_TYPE,
  schema: verifyDomainCommandDataSchema,
  description: "Record that a domain's ownership proof was found",
  verb: "verifyDomain",
});
export type VerifyDomainPayload = VerifyDomainCommandData;

export const ActivateConnectionCommand = connectionCommand({
  type: ACTIVATE_CONNECTION_COMMAND_TYPE,
  schema: activateConnectionCommandDataSchema,
  description: "Put a verified connection into service",
  verb: "activateConnection",
});
export type ActivateConnectionPayload = ActivateConnectionCommandData;

export const SuspendConnectionCommand = connectionCommand({
  type: SUSPEND_CONNECTION_COMMAND_TYPE,
  schema: suspendConnectionCommandDataSchema,
  description: "Stop a connection routing, reversibly",
  verb: "suspendConnection",
});
export type SuspendConnectionPayload = SuspendConnectionCommandData;

export const ResumeConnectionCommand = connectionCommand({
  type: RESUME_CONNECTION_COMMAND_TYPE,
  schema: resumeConnectionCommandDataSchema,
  description: "Return a suspended connection to service",
  verb: "resumeConnection",
});
export type ResumeConnectionPayload = ResumeConnectionCommandData;

export const RequestTeardownCommand = connectionCommand({
  type: REQUEST_TEARDOWN_COMMAND_TYPE,
  schema: requestTeardownCommandDataSchema,
  description: "Start a connection's grace period before removal",
  verb: "requestTeardown",
});
export type RequestTeardownPayload = RequestTeardownCommandData;

export const CompleteTeardownCommand = connectionCommand({
  type: COMPLETE_TEARDOWN_COMMAND_TYPE,
  schema: completeTeardownCommandDataSchema,
  description: "Remove a connection whose teardown grace has elapsed",
  verb: "completeTeardown",
});
export type CompleteTeardownPayload = CompleteTeardownCommandData;

export const GrandfatherConnectionCommand = connectionCommand({
  type: GRANDFATHER_CONNECTION_COMMAND_TYPE,
  schema: grandfatherConnectionCommandDataSchema,
  description:
    "Record the history an organization's legacy SSO strings already imply",
  verb: "grandfatherConnection",
});
export type GrandfatherConnectionPayload = GrandfatherConnectionCommandData;
