// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { GovernanceIngestionSource } from "@langwatch/enterprise-governance-contract";
import type { IngestionSourceFactData } from "@langwatch/enterprise-governance-contract/ingestion-source-lifecycle";
import type { EventingCommandSender } from "@langwatch/eventing";
import type { Instant } from "@langwatch/time";

type Sender = Pick<EventingCommandSender<IngestionSourceFactData>, "send">;

/** The senders governance's ingestion-source pipeline answers with, by command name. */
export type IngestionSourceFactSenders = Readonly<{
  recordIngestionSourceCreated: Sender;
  recordIngestionSourceWentLive: Sender;
}>;

/**
 * Records a source's created and went-live facts, which nurturing reacts to from its own side.
 * Each follows a committed write that must stand, so a failed record is reported, never thrown.
 * The senders arrive once the pipeline registers.
 */
export class IngestionSourceFactsService {
  static create(dependencies: {
    reportError: (error: unknown) => void;
  }): IngestionSourceFactsService {
    return new IngestionSourceFactsService(dependencies.reportError);
  }

  private senders: IngestionSourceFactSenders | undefined;

  private constructor(private readonly reportError: (error: unknown) => void) {}

  connect(senders: IngestionSourceFactSenders): void {
    this.senders = senders;
  }

  /** The source was created; its creator is the person who acted. */
  created(source: GovernanceIngestionSource): void {
    this.record(this.senders?.recordIngestionSourceCreated, {
      source,
      occurredAt: source.createdAt.getTime(),
    });
  }

  /** The source took its first data at `at`; told to the person who created it. */
  wentLive(source: GovernanceIngestionSource, at: Instant): void {
    this.record(this.senders?.recordIngestionSourceWentLive, {
      source,
      occurredAt: at.epochMilliseconds,
    });
  }

  private record(
    sender: Sender | undefined,
    { source, occurredAt }: { source: GovernanceIngestionSource; occurredAt: number },
  ): void {
    if (!sender) {
      this.reportError(new Error("governance_ingestion_source is not registered in this process"));
      return;
    }
    const data: IngestionSourceFactData = {
      tenantId: source.organizationId,
      organizationId: source.organizationId,
      sourceId: source.id,
      sourceType: source.sourceType,
      actorUserId: source.createdById,
      occurredAt,
    };
    // Sent at once, so the fact is queued before the caller moves on; a throw either way is
    // only reported.
    try {
      void sender.send(data).catch(this.reportError);
    } catch (error) {
      this.reportError(error);
    }
  }
}
