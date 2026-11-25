import type {
  CioBatchCall,
  CioEventName,
  CioOrgTraits,
  CioPersonTraits,
} from "@langwatch/enterprise-nurturing-contract";
import type { UserApi } from "@langwatch/user-contract";

import type { CustomerIoChannel } from "../channels/customer-io.channel.ts";
import { personUserIdsOf, withPersonEmails } from "../rules/nurturing-person-email.rules.ts";
import { NurturingFailureReportService } from "./nurturing-failure-report.service.ts";

const { reportFailure } = NurturingFailureReportService;

type TrackInput = Readonly<{
  userId: string;
  event: CioEventName;
  properties?: Record<string, unknown>;
  messageId?: string;
}>;

/**
 * Nurturing's named Customer.io operations over the configured delivery channel. Every person
 * call passes here, so each one gains the person's address or is dropped (withPersonEmails). A
 * failed address read is reported and sends nothing; only the OrThrow variants reject on it.
 */
export class NurturingService {
  private constructor(
    private readonly channel: CustomerIoChannel,
    /** The address has one home: read fresh from the user module, one query per send. */
    private readonly users: Pick<UserApi, "getProfiles">,
  ) {}

  static create({
    channel,
    users,
  }: {
    channel: CustomerIoChannel;
    users: Pick<UserApi, "getProfiles">;
  }): NurturingService {
    return new NurturingService(channel, users);
  }

  async identifyUser({
    userId,
    traits,
  }: {
    userId: string;
    traits: Partial<CioPersonTraits>;
  }): Promise<void> {
    const [call] = await this.withEmailsOrNone([{ type: "identify", userId, traits }]);
    if (call?.type === "identify") {
      await this.channel.identifyUser({ userId: call.userId, traits: call.traits });
    }
  }

  async trackEvent(input: TrackInput): Promise<void> {
    const calls = await this.withEmailsOrNone([{ type: "track", ...input }]);
    if (calls.length > 0) await this.channel.batch(calls);
  }

  /** As trackEvent, but rejects when Customer.io did not take the track. */
  async trackEventOrThrow(input: TrackInput): Promise<void> {
    const calls = await this.withEmails([{ type: "track", ...input }]);
    if (calls.length > 0) await this.channel.batchOrThrow(calls);
  }

  async groupUser({
    userId,
    groupId,
    traits,
  }: {
    userId: string;
    groupId: string;
    traits?: Partial<CioOrgTraits>;
  }): Promise<void> {
    await this.channel.groupUser({ userId, groupId, traits });
  }

  async batch(calls: CioBatchCall[]): Promise<void> {
    const sent = await this.withEmailsOrNone(calls);
    if (sent.length > 0) await this.channel.batch(sent);
  }

  /** As batch, but rejects when Customer.io did not take the batch. */
  async batchOrThrow(calls: CioBatchCall[]): Promise<void> {
    const sent = await this.withEmails(calls);
    if (sent.length > 0) await this.channel.batchOrThrow(sent);
  }

  /** As withEmails, but a failed read is reported and sends nothing, as the channel's posts do. */
  private withEmailsOrNone(calls: readonly CioBatchCall[]): Promise<CioBatchCall[]> {
    return this.withEmails(calls).catch((error: unknown) => {
      reportFailure(error);
      return [];
    });
  }

  private async withEmails(calls: readonly CioBatchCall[]): Promise<CioBatchCall[]> {
    const userIds = personUserIdsOf(calls);
    // A channel without a key sends nothing, so no address is read for it.
    if (userIds.length === 0 || !this.channel.isEnabled()) return [...calls];
    const profiles = await this.users.getProfiles({ userIds });
    const emails = new Map(
      profiles.flatMap((profile) => (profile.email ? [[profile.id, profile.email] as const] : [])),
    );
    return withPersonEmails({ calls, emails });
  }
}
