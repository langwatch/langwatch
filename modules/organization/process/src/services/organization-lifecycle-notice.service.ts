import type { EventingCommandSender } from "@langwatch/eventing";
import {
  integrationMethodSelectionSchema,
  nurturingSignUpDataSchema,
} from "@langwatch/organization-contract";
import { nowInstant } from "@langwatch/time";

import type {
  RecordCreatedCommandData,
  RecordIntegrationMethodChosenCommandData,
  RecordInviteAcceptedCommandData,
  RecordMemberDisabledCommandData,
  RecordMemberEnabledCommandData,
  RecordMemberDepartmentChangedCommandData,
  RecordMemberRemovedCommandData,
  RecordMembersInvitedCommandData,
  RecordPersonalWorkspaceProvisionedCommandData,
  RecordPersonalTeamCreatedCommandData,
  RecordPersonalWorkspaceArchivedCommandData,
  RecordPersonalWorkspaceRevivedCommandData,
  RecordPersonalWorkspaceFeaturesChangedCommandData,
  RecordPresenceSettingChangedCommandData,
  RecordSignedUpCommandData,
  RecordTraceSharingDisabledCommandData,
} from "../eventing/organization-lifecycle.events.ts";

type Sender<Data> = Pick<EventingCommandSender<Data>, "send">;
type Recorded<Data> = Omit<Data, "tenantId" | "occurredAt">;

export type OrganizationLifecycleSenders = Readonly<{
  recordSignedUp: Sender<RecordSignedUpCommandData>;
  recordMembersInvited: Sender<RecordMembersInvitedCommandData>;
  recordInviteAccepted: Sender<RecordInviteAcceptedCommandData>;
  recordIntegrationMethodChosen: Sender<RecordIntegrationMethodChosenCommandData>;
  recordPersonalWorkspaceProvisioned: Sender<RecordPersonalWorkspaceProvisionedCommandData>;
  recordPersonalTeamCreated: Sender<RecordPersonalTeamCreatedCommandData>;
  recordPersonalWorkspaceArchived: Sender<RecordPersonalWorkspaceArchivedCommandData>;
  recordPersonalWorkspaceRevived: Sender<RecordPersonalWorkspaceRevivedCommandData>;
  recordPersonalWorkspaceFeaturesChanged: Sender<RecordPersonalWorkspaceFeaturesChangedCommandData>;
  recordPresenceSettingChanged: Sender<RecordPresenceSettingChangedCommandData>;
  recordTraceSharingDisabled: Sender<RecordTraceSharingDisabledCommandData>;
  recordMemberDisabled: Sender<RecordMemberDisabledCommandData>;
  recordMemberEnabled: Sender<RecordMemberEnabledCommandData>;
  recordMemberRemoved: Sender<RecordMemberRemovedCommandData>;
  recordMemberDepartmentChanged: Sender<RecordMemberDepartmentChangedCommandData>;
  recordCreated: Sender<RecordCreatedCommandData>;
}>;

/**
 * Records a sign-up, an invitation batch and an acceptance as organization's events, which peers
 * such as nurturing react to from their own side (§9). The senders arrive once the pipeline
 * registers; a failed record is reported, never thrown.
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

  /** Project creates the personal team's project, mints its key and records it as created. */
  personalTeamCreated(input: Recorded<RecordPersonalTeamCreatedCommandData>): void {
    this.#send(this.#senders?.recordPersonalTeamCreated, {
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

  /** The organization's presence switch changed; presence folds it from its own side (§9). */
  presenceSettingChanged(
    input: Readonly<{
      organizationId: string;
      presenceEnabled: boolean;
      changedByUserId: string | null;
    }>,
  ): void {
    this.#send(this.#senders?.recordPresenceSettingChanged, {
      ...this.#envelope(input.organizationId),
      ...input,
    });
  }

  /** The backfill's record of a stored setting; throws, so the task fails rather than skips. */
  async recordStoredPresenceSetting(
    input: Readonly<{ organizationId: string; presenceEnabled: boolean }>,
  ): Promise<void> {
    const sender = this.#senders?.recordPresenceSettingChanged;
    if (!sender) throw new Error("organization_lifecycle is not registered in this process");
    await sender.send({ ...this.#envelope(input.organizationId), ...input, backfilled: true });
  }

  /** Trace sharing switched off; awaited and loud, since share revokes only on this record. */
  async traceSharingDisabled(
    input: Readonly<{
      organizationId: string;
      projectIds: string[];
      changedByUserId: string | null;
    }>,
  ): Promise<void> {
    const sender = this.#senders?.recordTraceSharingDisabled;
    if (!sender) throw new Error("organization_lifecycle is not registered in this process");
    await sender.send({ ...this.#envelope(input.organizationId), ...input });
  }

  /** A seat taken away; awaited and loud, since user ends the sessions only on this record. */
  async memberDisabled(
    input: Readonly<{ organizationId: string; userId: string; disabledByUserId: string | null }>,
  ): Promise<void> {
    const sender = this.#senders?.recordMemberDisabled;
    if (!sender) throw new Error("organization_lifecycle is not registered in this process");
    await sender.send({ ...this.#envelope(input.organizationId), ...input });
  }

  /** A seat given back; awaited and loud, since governance rejoins aggregates on this record. */
  async memberEnabled(input: Recorded<RecordMemberEnabledCommandData>): Promise<void> {
    const sender = this.#senders?.recordMemberEnabled;
    if (!sender) throw new Error("organization_lifecycle is not registered in this process");
    await sender.send({ ...this.#envelope(input.organizationId), ...input });
  }

  /** A member removed; awaited and loud, since governance revokes aggregates on this record. */
  async memberRemoved(
    input: Recorded<RecordMemberRemovedCommandData> & { occurredAt?: number },
  ): Promise<void> {
    const sender = this.#senders?.recordMemberRemoved;
    if (!sender) throw new Error("organization_lifecycle is not registered in this process");
    await sender.send({ ...this.#envelope(input.organizationId), ...input });
  }

  /** A department set or cleared; awaited and loud, since governance re-reads aggregates on it. */
  async memberDepartmentChanged(
    input: Recorded<RecordMemberDepartmentChangedCommandData>,
  ): Promise<void> {
    const sender = this.#senders?.recordMemberDepartmentChanged;
    if (!sender) throw new Error("organization_lifecycle is not registered in this process");
    await sender.send({ ...this.#envelope(input.organizationId), ...input });
  }

  /** An organization now exists; awaited and loud, since prompt seeds tags only on this record. */
  async created(
    input: Readonly<{ organizationId: string; organizationName: string }>,
  ): Promise<void> {
    const sender = this.#senders?.recordCreated;
    if (!sender) throw new Error("organization_lifecycle is not registered in this process");
    await sender.send({ ...this.#envelope(input.organizationId), ...input });
  }

  /** A member's personal teams archived; awaited and loud, since project archives only on this. */
  async personalWorkspaceArchived(
    input: Recorded<RecordPersonalWorkspaceArchivedCommandData>,
  ): Promise<void> {
    const sender = this.#senders?.recordPersonalWorkspaceArchived;
    if (!sender) throw new Error("organization_lifecycle is not registered in this process");
    await sender.send({ ...this.#envelope(input.organizationId), ...input });
  }

  /** A personal team revived; awaited and loud, since project revives only on this record. */
  async personalWorkspaceRevived(
    input: Recorded<RecordPersonalWorkspaceRevivedCommandData>,
  ): Promise<void> {
    const sender = this.#senders?.recordPersonalWorkspaceRevived;
    if (!sender) throw new Error("organization_lifecycle is not registered in this process");
    await sender.send({ ...this.#envelope(input.organizationId), ...input });
  }

  /** Feature switches changed; awaited and loud, since project stores them only on this. */
  async personalWorkspaceFeaturesChanged(
    input: Recorded<RecordPersonalWorkspaceFeaturesChangedCommandData>,
  ): Promise<void> {
    const sender = this.#senders?.recordPersonalWorkspaceFeaturesChanged;
    if (!sender) throw new Error("organization_lifecycle is not registered in this process");
    await sender.send({ ...this.#envelope(input.organizationId ?? input.projectId), ...input });
  }

  /** Reports a failure its caller must not raise over the error it is already throwing. */
  reportError(error: unknown): void {
    this.dependencies.reportError(error);
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
