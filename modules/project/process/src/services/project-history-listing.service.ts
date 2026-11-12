/**
 * The history listing step: one pass over the projects table, a page at a time in id order, each
 * page's personal owners and first messages sent as one batch each, as project's own facts.
 * Spec: modules/project/specs/project-history-listing.feature
 */
import type { EventingCommandSender } from "@langwatch/eventing";
import { z } from "zod";

import type {
  RecordProjectFirstMessageListedCommandData,
  RecordProjectPersonalOwnerListedCommandData,
} from "../eventing/project-lifecycle.events.ts";
import type { ProjectBackfillRow, ProjectRepository } from "../repositories/project.repository.ts";
import { ProjectTablePagingService } from "./project-table-paging.service.ts";

export type ProjectHistoryListingReport = {
  /** Personal projects with an owner; a dry run counts them by the rule a run sends by. */
  ownerFactsToSend: number;
  /** Projects that already received their first message, by the same rule. */
  firstMessageFactsToSend: number;
  /** Projects whose team or organization is gone, so the step sends nothing for them. */
  skippedOrphans: number;
  orphanProjectIds: string[];
};

/**
 * The step's saved checkpoint: the last project of a page and the counts through it, saved in one
 * write, so a crash after a page's send resumes before that page and counts it once.
 */
const projectHistoryListingCheckpointSchema = z.object({
  afterProjectId: z.string(),
  ownerFactsToSend: z.number().int().nonnegative(),
  firstMessageFactsToSend: z.number().int().nonnegative(),
  skippedOrphans: z.number().int().nonnegative(),
  orphanProjectIds: z.array(z.string()),
});
export type ProjectHistoryListingCheckpoint = z.infer<typeof projectHistoryListingCheckpointSchema>;

export type ProjectHistoryListingRun = Readonly<{
  dryRun: boolean;
  signal: AbortSignal;
  /** The last saved checkpoint, as the ledger holds it; a dry run reads the whole table instead. */
  resumeFrom: unknown;
  onPageDone: (checkpoint: ProjectHistoryListingCheckpoint) => Promise<void>;
}>;

const NOTHING_COUNTED: ProjectHistoryListingReport = {
  ownerFactsToSend: 0,
  firstMessageFactsToSend: 0,
  skippedOrphans: 0,
  orphanProjectIds: [],
};

export type ProjectHistoryListingSenders = Readonly<{
  recordPersonalOwnerListed: Pick<
    EventingCommandSender<RecordProjectPersonalOwnerListedCommandData>,
    "sendBatch"
  >;
  recordFirstMessageListed: Pick<
    EventingCommandSender<RecordProjectFirstMessageListedCommandData>,
    "sendBatch"
  >;
}>;

type Dependencies = Readonly<{
  projects: Pick<ProjectRepository, "findBackfillPage">;
  logger: Readonly<{ warn(payload: Readonly<Record<string, unknown>>, message: string): void }>;
}>;

/** A personal project with an owner; the dry run and the run both count by it. */
const hasPersonalOwner = (
  project: ProjectBackfillRow,
): project is ProjectBackfillRow & { ownerUserId: string } =>
  project.isPersonal && project.ownerUserId !== null;

/** Where a run starts: a dry run counts the whole table, so a saved checkpoint never shrinks it. */
function startOf({
  dryRun,
  resumeFrom,
}: Readonly<{ dryRun: boolean; resumeFrom: unknown }>): ProjectHistoryListingReport & {
  afterProjectId: string | null;
} {
  const resumed = dryRun ? undefined : projectHistoryListingCheckpointSchema.safeParse(resumeFrom);
  return resumed?.success ? resumed.data : { afterProjectId: null, ...NOTHING_COUNTED };
}

/**
 * Lists every personal project's owner and every project that already received its first message,
 * archived ones included, keyed per project so a rerun adds nothing new. A project left without a
 * team or organization is skipped and counted. The senders arrive once the pipeline registers.
 */
export class ProjectHistoryListingService {
  #senders: ProjectHistoryListingSenders | undefined;
  readonly #table: ProjectTablePagingService;

  private constructor(deps: Dependencies) {
    this.#table = ProjectTablePagingService.create(deps);
  }

  static create(deps: Dependencies): ProjectHistoryListingService {
    return new ProjectHistoryListingService(deps);
  }

  connect(senders: ProjectHistoryListingSenders): void {
    this.#senders = senders;
  }

  async sendHistory({
    dryRun,
    signal,
    resumeFrom,
    onPageDone,
  }: ProjectHistoryListingRun): Promise<ProjectHistoryListingReport> {
    const { afterProjectId, ...counted } = startOf({ dryRun, resumeFrom });
    let report: ProjectHistoryListingReport = counted;
    await this.#table.walk({
      stepName: "the project history listing",
      afterProjectId,
      orphans: report,
      signal,
      onPage: async ({ projects, orphans, afterProjectId: cursor, occurredAt }) => {
        const owners = projects.filter(hasPersonalOwner);
        const firstMessages = projects.filter((project) => project.firstMessage);
        if (!dryRun) await this.#sendPage({ owners, firstMessages, occurredAt });
        report = {
          ownerFactsToSend: report.ownerFactsToSend + owners.length,
          firstMessageFactsToSend: report.firstMessageFactsToSend + firstMessages.length,
          ...orphans,
        };
        if (!dryRun) await onPageDone({ afterProjectId: cursor, ...report });
      },
    });
    return report;
  }

  /** Throws, so the step retries the page. */
  async #sendPage({
    owners,
    firstMessages,
    occurredAt,
  }: {
    owners: readonly (ProjectBackfillRow & { ownerUserId: string })[];
    firstMessages: readonly ProjectBackfillRow[];
    occurredAt: number;
  }): Promise<void> {
    const senders = this.#senders;
    if (!senders) throw new Error("project_lifecycle is not registered in this process");
    if (owners.length > 0) {
      await senders.recordPersonalOwnerListed.sendBatch(
        owners.map((project) => ({
          tenantId: project.id,
          projectId: project.id,
          organizationId: project.organizationId,
          ownerUserId: project.ownerUserId,
          occurredAt,
        })),
      );
    }
    if (firstMessages.length > 0) {
      await senders.recordFirstMessageListed.sendBatch(
        firstMessages.map((project) => ({
          tenantId: project.id,
          projectId: project.id,
          organizationId: project.organizationId,
          occurredAt,
        })),
      );
    }
  }
}
