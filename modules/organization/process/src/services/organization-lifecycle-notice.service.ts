import {
  integrationMethodSelectionSchema,
  nurturingSignUpDataSchema,
} from "@langwatch/enterprise-nurturing-contract";
import type { EventingCommandSender } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type {
  RecordIntegrationMethodChosenCommandData,
  RecordInviteAcceptedCommandData,
  RecordMembersInvitedCommandData,
  RecordPersonalWorkspaceProvisionedCommandData,
  RecordSignedUpCommandData,
} from "../eventing/organization-lifecycle.events.ts";

type Sender<Data> = Pick<EventingCommandSender<Data>, "send">;
type Recorded<Data> = Omit<Data, "tenantId" | "occurredAt">;

export type OrganizationLifecycleSenders = Readonly<{
  recordSignedUp: Sender<RecordSignedUpCommandData>;
  recordMembersInvited: Sender<RecordMembersInvitedCommandData>;
  recordInviteAccepted: Sender<RecordInviteAcceptedCommandData>;
  recordIntegrationMethodChosen: Sender<RecordIntegrationMethodChosenCommandData>;
  recordPersonalWorkspaceProvisioned: Sender<RecordPersonalWorkspaceProvisionedCommandData>;
}>;

/**
 * Where a sign-up, an invitation batch and an acceptance are recorded as organization's events,
 * which the worker hands to nurturing (§9). The senders arrive once the pipeline registers, and a
 * record that fails is reported, never thrown: an organization that was not announced still is one.
 */
export class OrganizationLifecycleNoticeService {
  static create(dependencies: {
    reportError: (error: unknown) => void;
  }): OrganizationLifecycleNoticeService {
    return new OrganizationLifecycleNoticeService(dependencies);
  }

  #senders: OrganizationLifecycleSenders | undefined;

  private constructor(private readonly dependencies: { reportError: (error: unknown) => void }) {}

  connect(senders: OrganizationLifecycleSenders): void {
    this.#senders = senders;
  }

  signedUp(
    input: Omit<Recorded<RecordSignedUpCommandData>, "signUpData"> & { signUpData?: unknown },
  ): void {
    const signUpData = nurturingSignUpDataSchema.safeParse(input.signUpData ?? {});
    this.#send(this.#senders?.recordSignedUp, {
      ...this.#envelope(input.organizationId),
      ...input,
      signUpData: signUpData.success ? signUpData.data : null,
    });
  }

  membersInvited(input: Recorded<RecordMembersInvitedCommandData>): void {
    this.#send(this.#senders?.recordMembersInvited, {
      ...this.#envelope(input.organizationId),
      ...input,
    });
  }

  inviteAccepted(input: Recorded<RecordInviteAcceptedCommandData>): void {
    this.#send(this.#senders?.recordInviteAccepted, {
      ...this.#envelope(input.organizationId),
      ...input,
    });
  }

  /** Project records the new personal project as created, so analytics writes its key-map row. */
  personalWorkspaceProvisioned(
    input: Recorded<RecordPersonalWorkspaceProvisionedCommandData>,
  ): void {
    this.#send(this.#senders?.recordPersonalWorkspaceProvisioned, {
      ...this.#envelope(input.organizationId),
      ...input,
    });
  }

  /** A selection outside main's four is reported and not recorded, as main's mapping refused it. */
  integrationMethodChosen(input: Readonly<{ userId: string; selection: string }>): void {
    const selection = integrationMethodSelectionSchema.safeParse(input.selection);
    if (!selection.success) {
      this.dependencies.reportError(selection.error);
      return;
    }
    this.#send(this.#senders?.recordIntegrationMethodChosen, {
      ...this.#envelope(input.userId),
      userId: input.userId,
      selection: selection.data,
    });
  }

  #envelope(tenantId: string) {
    return { tenantId, occurredAt: nowInstant().epochMilliseconds };
  }

  #send<Data extends Record<string, unknown>>(sender: Sender<Data> | undefined, data: Data): void {
    if (!sender) {
      this.dependencies.reportError(
        new Error("organization_lifecycle is not registered in this process"),
      );
      return;
    }
    void Promise.resolve()
      .then(() => sender.send(data))
      .catch((failure: unknown) => this.dependencies.reportError(failure));
  }
}
