import type { EventingCommandSender } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { RecordProjectCreatedCommandData } from "../eventing/project-lifecycle.events.ts";

export type ProjectLifecycleSenders = Readonly<{
  recordProjectCreated: Pick<EventingCommandSender<RecordProjectCreatedCommandData>, "send">;
}>;

type NoticeLogger = Readonly<{
  error(payload: Readonly<Record<string, unknown>>, message: string): void;
}>;

/**
 * Where a new project is recorded as project's event; analytics writes its LangWatchQL key-map
 * row from it (§9). Best effort, as main's inline sync was: a failed record is logged and the
 * next deploy's backfill writes the row. The sender arrives once the pipeline registers.
 */
export class ProjectCreatedNoticeService {
  static create(dependencies: { logger: NoticeLogger }): ProjectCreatedNoticeService {
    return new ProjectCreatedNoticeService(dependencies);
  }

  #senders: ProjectLifecycleSenders | undefined;

  private constructor(private readonly dependencies: { logger: NoticeLogger }) {}

  connect(senders: ProjectLifecycleSenders): void {
    this.#senders = senders;
  }

  /** Throws when the record fails, for a subscriber whose delivery the queue retries. */
  async record(input: Readonly<{ projectId: string; organizationId: string }>): Promise<void> {
    const senders = this.#senders;
    if (!senders) throw new Error("project_lifecycle is not registered in this process");
    await senders.recordProjectCreated.send({
      tenantId: input.projectId,
      projectId: input.projectId,
      organizationId: input.organizationId,
      occurredAt: nowInstant().epochMilliseconds,
    });
  }

  async created(input: Readonly<{ projectId: string; organizationId: string }>): Promise<void> {
    try {
      await this.record(input);
    } catch (error) {
      this.dependencies.logger.error(
        { projectId: input.projectId, error },
        "recording the new project failed; the next deploy's key-map backfill writes its row",
      );
    }
  }
}
