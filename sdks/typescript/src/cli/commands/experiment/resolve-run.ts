import { ExperimentsApiService } from "@/client-sdk/services/experiments/experiments-api.service";

// Resolve which run an experiment subcommand should act on: an explicit
// --run-id when given, otherwise the latest run for the experiment. The runs
// list is returned newest-first by the API, so the first entry is the latest.
export const resolveRunId = async ({
  service,
  experimentSlug,
  runId,
}: {
  service: ExperimentsApiService;
  experimentSlug: string;
  runId?: string;
}): Promise<string> => {
  const explicit = runId?.trim();
  if (explicit) return explicit;

  const { runs } = await service.listRuns({ experimentSlug, pageSize: 1 });
  const latest = runs?.[0];
  if (!latest) {
    throw new Error(
      `No runs found for experiment "${experimentSlug}". Start one first, or pass --run-id <id>.`,
    );
  }
  return latest.runId;
};
