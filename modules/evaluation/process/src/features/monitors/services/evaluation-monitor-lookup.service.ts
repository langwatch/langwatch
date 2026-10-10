import type {
  EvaluationMonitorSummary,
  EvaluationSlugLookup,
} from "@langwatch/evaluation-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";

/** The monitor an evaluate call names by slug, read from its owner. */
export class EvaluationMonitorLookupService {
  private constructor(private readonly monitors: Pick<MonitorApi, "findBySlug">) {}

  static create(monitors: Pick<MonitorApi, "findBySlug">): EvaluationMonitorLookupService {
    return new EvaluationMonitorLookupService(monitors);
  }

  async findMonitorBySlug(input: EvaluationSlugLookup): Promise<EvaluationMonitorSummary | null> {
    const [monitor] = await this.monitors.findBySlug({
      projectId: input.projectId,
      slug: input.slug,
    });
    if (!monitor) return null;

    return {
      id: monitor.id,
      name: monitor.name,
      checkType: monitor.checkType,
      parameters: monitor.parameters,
      enabled: monitor.enabled,
    };
  }
}
