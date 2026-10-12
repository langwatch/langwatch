import { Task } from "@langwatch/task";

import {
  type AnnotationTraceBackfillPeers as BackfillPeers,
  AnnotationTraceBackfillService,
} from "#services/annotation-trace-backfill.service";

/**
 * Port of main's backfillAnnotationsToClickhouse, kept as a manual re-run of the
 * `annotation:record-trace-annotations` upgrade step: every annotation recorded on its trace again.
 */
export class AnnotationTraceBackfillTask extends Task {
  readonly name = "backfill-annotations-to-clickhouse";
  readonly description = "Records every annotation on its trace again, so search agrees with them.";

  private constructor(private readonly peers: BackfillPeers) {
    super();
  }

  static create(peers: BackfillPeers): AnnotationTraceBackfillTask {
    return new AnnotationTraceBackfillTask(peers);
  }

  async run({ args, signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    await AnnotationTraceBackfillService.create({ peers: this.peers }).backfill({
      after: undefined,
      dryRun: args.includes("--dry-run"),
      signal,
      onPage: async () => {},
    });
  }
}
