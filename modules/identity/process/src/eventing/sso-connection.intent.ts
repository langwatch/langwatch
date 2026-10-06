import {
  type Command,
  type CommandHandler,
  type CommandSchema,
  defineCommandSchema,
} from "@langwatch/eventing";
import {
  ACTIVATE_CONNECTION_COMMAND_TYPE,
  APPROVE_DOMAIN_CLAIM_COMMAND_TYPE,
  ATTEST_DOMAIN_COMMAND_TYPE,
  WITHDRAW_DOMAIN_COMMAND_TYPE,
  activateConnectionCommandDataSchema,
  approveDomainClaimCommandDataSchema,
  attestDomainCommandDataSchema,
  withdrawDomainCommandDataSchema,
  CLAIM_DOMAIN_COMMAND_TYPE,
  COMPLETE_TEARDOWN_COMMAND_TYPE,
  claimDomainCommandDataSchema,
  completeTeardownCommandDataSchema,
  DISCARD_CONNECTION_COMMAND_TYPE,
  discardConnectionCommandDataSchema,
  GRANDFATHER_CONNECTION_COMMAND_TYPE,
  grandfatherConnectionCommandDataSchema,
  REGISTER_CONNECTION_COMMAND_TYPE,
  REGISTER_REPLACEMENT_CONNECTION_COMMAND_TYPE,
  registerReplacementConnectionCommandDataSchema,
  RENAME_CONNECTION_COMMAND_TYPE,
  renameConnectionCommandDataSchema,
  UPDATE_CONNECTION_IDP_COMMAND_TYPE,
  updateConnectionIdpCommandDataSchema,
  SELECT_MIGRATION_ROUTE_COMMAND_TYPE,
  selectMigrationRouteCommandDataSchema,
  BEGIN_MIGRATION_FINALIZATION_COMMAND_TYPE,
  beginMigrationFinalizationCommandDataSchema,
  FINALIZE_MIGRATION_COMMAND_TYPE,
  finalizeMigrationCommandDataSchema,
  RECORD_DOMAIN_PROOF_ABSENT_COMMAND_TYPE,
  RECORD_DOMAIN_PROOF_PRESENT_COMMAND_TYPE,
  recordDomainProofAbsentCommandDataSchema,
  recordDomainProofPresentCommandDataSchema,
  REJECT_DOMAIN_CLAIM_COMMAND_TYPE,
  REQUEST_TEARDOWN_COMMAND_TYPE,
  REQUEST_VERIFICATION_COMMAND_TYPE,
  RESUME_CONNECTION_COMMAND_TYPE,
  registerConnectionCommandDataSchema,
  rejectDomainClaimCommandDataSchema,
  requestTeardownCommandDataSchema,
  requestVerificationCommandDataSchema,
  resumeConnectionCommandDataSchema,
  SET_ARRIVAL_POLICY_COMMAND_TYPE,
  setArrivalPolicyCommandDataSchema,
  type SsoConnectionCommand,
  SUSPEND_CONNECTION_COMMAND_TYPE,
  suspendConnectionCommandDataSchema,
  VERIFY_DOMAIN_COMMAND_TYPE,
  verifyDomainCommandDataSchema,
} from "@langwatch/identity-contract";
import type { ZodTypeAny, z } from "zod";

import type { SsoConnectionGuardsService } from "../services/sso-connection-guards.service.ts";
import { ssoConnectionEventsFor } from "./sso-connection-events.intent.ts";
import type { SsoConnectionEvent } from "./sso-connection-state.projection.ts";

/**
 * The connection pipeline's thirteen verbs plus grandfathering, as the queue's STAGED RE-RUN of
 * each: the same guard the calling path ran, the same envelope. A retried command carries the same
 * commandId, so the re-run costs no second event.
 */

type GuardVerb = {
  [K in keyof SsoConnectionGuardsService]: SsoConnectionGuardsService[K] extends (
    data: never,
  ) => Promise<unknown>
    ? K
    : never;
}[keyof SsoConnectionGuardsService];

interface SsoConnectionCommandConstructor<Schema extends ZodTypeAny> {
  new (guards: SsoConnectionGuardsService): {
    handle(command: Command<z.infer<Schema>>): Promise<SsoConnectionEvent[]>;
  };
  readonly schema: CommandSchema<z.infer<Schema>, SsoConnectionCommand["type"]>;
  getAggregateId(payload: { connectionId: string }): string;
}

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
}): SsoConnectionCommandConstructor<Schema> {
  type Data = z.infer<Schema>;
  return class SsoConnectionCommandHandler implements CommandHandler<
    Command<Data>,
    SsoConnectionEvent
  > {
    static readonly schema = defineCommandSchema(type, schema, description);

    /** The CONNECTION is the aggregate — never the organization. One
     *  connection's commands share a lane; two connections never do. */
    static getAggregateId(payload: { connectionId: string }): string {
      return payload.connectionId;
    }

    constructor(private readonly guards: SsoConnectionGuardsService) {}

    async handle(command: Command<Data>): Promise<SsoConnectionEvent[]> {
      const data = command.data as never;
      const facts = await (this.guards[verb] as (input: never) => Promise<never[]>)(data);
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

export const ClaimDomainCommand = connectionCommand({
  type: CLAIM_DOMAIN_COMMAND_TYPE,
  schema: claimDomainCommandDataSchema,
  description: "Claim an email domain for a connection, pending ops approval",
  verb: "claimDomain",
});

export const ApproveDomainClaimCommand = connectionCommand({
  type: APPROVE_DOMAIN_CLAIM_COMMAND_TYPE,
  schema: approveDomainClaimCommandDataSchema,
  description: "Record an operator approving a domain claim",
  verb: "approveDomainClaim",
});

export const RejectDomainClaimCommand = connectionCommand({
  type: REJECT_DOMAIN_CLAIM_COMMAND_TYPE,
  schema: rejectDomainClaimCommandDataSchema,
  description: "Record an operator rejecting a domain claim, with the note",
  verb: "rejectDomainClaim",
});

export const DiscardConnectionCommand = connectionCommand({
  type: DISCARD_CONNECTION_COMMAND_TYPE,
  schema: discardConnectionCommandDataSchema,
  description: "Abandon a draft connection",
  verb: "discardConnection",
});

export const RequestVerificationCommand = connectionCommand({
  type: REQUEST_VERIFICATION_COMMAND_TYPE,
  schema: requestVerificationCommandDataSchema,
  description: "Open a domain ownership ceremony, recording the proof's hash",
  verb: "requestVerification",
});

export const AttestDomainCommand = connectionCommand({
  type: ATTEST_DOMAIN_COMMAND_TYPE,
  schema: attestDomainCommandDataSchema,
  description: "Record a platform operator attesting that a domain is the organization's",
  verb: "attestDomain",
});

export const WithdrawDomainCommand = connectionCommand({
  type: WITHDRAW_DOMAIN_COMMAND_TYPE,
  schema: withdrawDomainCommandDataSchema,
  description: "Take a domain back out of the connection",
  verb: "withdrawDomain",
});

export const VerifyDomainCommand = connectionCommand({
  type: VERIFY_DOMAIN_COMMAND_TYPE,
  schema: verifyDomainCommandDataSchema,
  description: "Record that a domain's ownership proof was found",
  verb: "verifyDomain",
});

export const ActivateConnectionCommand = connectionCommand({
  type: ACTIVATE_CONNECTION_COMMAND_TYPE,
  schema: activateConnectionCommandDataSchema,
  description: "Put a verified connection into service",
  verb: "activateConnection",
});

export const SuspendConnectionCommand = connectionCommand({
  type: SUSPEND_CONNECTION_COMMAND_TYPE,
  schema: suspendConnectionCommandDataSchema,
  description: "Stop a connection routing, reversibly",
  verb: "suspendConnection",
});

export const ResumeConnectionCommand = connectionCommand({
  type: RESUME_CONNECTION_COMMAND_TYPE,
  schema: resumeConnectionCommandDataSchema,
  description: "Return a suspended connection to service",
  verb: "resumeConnection",
});

export const RequestTeardownCommand = connectionCommand({
  type: REQUEST_TEARDOWN_COMMAND_TYPE,
  schema: requestTeardownCommandDataSchema,
  description: "Start a connection's grace period before removal",
  verb: "requestTeardown",
});

export const CompleteTeardownCommand = connectionCommand({
  type: COMPLETE_TEARDOWN_COMMAND_TYPE,
  schema: completeTeardownCommandDataSchema,
  description: "Remove a connection whose teardown grace has elapsed",
  verb: "completeTeardown",
});

export const GrandfatherConnectionCommand = connectionCommand({
  type: GRANDFATHER_CONNECTION_COMMAND_TYPE,
  schema: grandfatherConnectionCommandDataSchema,
  description: "Record the history an organization's legacy SSO strings already imply",
  verb: "grandfatherConnection",
});

export const RenameConnectionCommand = connectionCommand({
  type: RENAME_CONNECTION_COMMAND_TYPE,
  schema: renameConnectionCommandDataSchema,
  description: "Change the word an administrator reads on a connection's card",
  verb: "renameConnection",
});

export const UpdateConnectionIdpCommand = connectionCommand({
  type: UPDATE_CONNECTION_IDP_COMMAND_TYPE,
  schema: updateConnectionIdpCommandDataSchema,
  description: "Replace the identity provider settings a connection dials",
  verb: "updateConnectionIdp",
});

export const RegisterReplacementConnectionCommand = connectionCommand({
  type: REGISTER_REPLACEMENT_CONNECTION_COMMAND_TYPE,
  schema: registerReplacementConnectionCommandDataSchema,
  description: "Register the direct connection that replaces a grandfathered one",
  verb: "registerReplacementConnection",
});

export const SelectMigrationRouteCommand = connectionCommand({
  type: SELECT_MIGRATION_ROUTE_COMMAND_TYPE,
  schema: selectMigrationRouteCommandDataSchema,
  description: "Choose which connection of a migration pair decides ordinary sign-ins",
  verb: "selectMigrationRoute",
});

export const BeginMigrationFinalizationCommand = connectionCommand({
  type: BEGIN_MIGRATION_FINALIZATION_COMMAND_TYPE,
  schema: beginMigrationFinalizationCommandDataSchema,
  description: "Open the durable gate that retiring the legacy connection runs behind",
  verb: "beginMigrationFinalization",
});

export const FinalizeMigrationCommand = connectionCommand({
  type: FINALIZE_MIGRATION_COMMAND_TYPE,
  schema: finalizeMigrationCommandDataSchema,
  description: "Record that the legacy connection has been retired",
  verb: "finalizeMigration",
});

export const SetArrivalPolicyCommand = connectionCommand({
  type: SET_ARRIVAL_POLICY_COMMAND_TYPE,
  schema: setArrivalPolicyCommandDataSchema,
  description: "Choose what happens to a person this connection has never seen",
  verb: "setArrivalPolicy",
});

export const RecordDomainProofAbsentCommand = connectionCommand({
  type: RECORD_DOMAIN_PROOF_ABSENT_COMMAND_TYPE,
  schema: recordDomainProofAbsentCommandDataSchema,
  description: "Record that a re-check found a domain's ownership proof gone",
  verb: "recordDomainProofAbsent",
});

export const RecordDomainProofPresentCommand = connectionCommand({
  type: RECORD_DOMAIN_PROOF_PRESENT_COMMAND_TYPE,
  schema: recordDomainProofPresentCommandDataSchema,
  description: "Record that a re-check found a domain's ownership proof back",
  verb: "recordDomainProofPresent",
});
