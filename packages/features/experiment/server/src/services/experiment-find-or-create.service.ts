/**
 * The rule that turns an SDK's `experiment_slug` into an experiment row.
 *
 * THREE callers derive an experiment from a slug and they must all derive the
 * SAME one: `POST /api/experiment/init` (the first call an SDK run makes),
 * `POST /api/evaluations/batch/log_results` (the rows that run then reports)
 * and the DSPy step log. An SDK whose slug resolved one way through the init
 * door and another way through the batch log would silently write its results
 * against a second experiment, and nothing downstream could tell the two
 * apart — which is why this is one service rather than a rule each transport
 * restates.
 *
 * THE SLUGIFY WRAPPER IS INLINED, NOT IMPORTED. The application reached
 * `slugify` through a shared `~/utils/slugify` module that pre-replaces `:`,
 * `?`, `&` and `_` with `-` and defaults the options to
 * `{ lower: true, strict: true, replacement: "-" }`. Both halves are
 * load-bearing: without the pre-replacement an experiment named
 * `my_batch_run` slugs to `mybatchrun`, which is a different URL for the same
 * name. The only two surviving copies of that module are browser modules
 * (`@langwatch/workflow-web` and `@langwatch/trace-web`) and a server package
 * may not value-import one, so the four characters and the three options are
 * transcribed here and pinned by literal in this module's own test — the same
 * precedent `EvaluationNameAutoslugService` records.
 */
import type { Experiment, ExperimentService, ExperimentType } from "@langwatch/experiment-contract";
import { nanoid } from "nanoid";
import originalSlugify from "slugify";

/** What an SDK names an experiment by. Either identifier, or both. */
export type ExperimentFindOrCreateInput = Readonly<{
  /**
   * Only the id is read. The API boundary carries a project IDENTITY rather
   * than a project row, so naming the row here would ask three call sites for
   * a read none of them makes.
   */
  projectId: string;
  experimentId?: string | null | undefined;
  experimentSlug?: string | null | undefined;
  experimentType: ExperimentType;
  experimentName?: string | undefined;
  workflowId?: string | undefined;
}>;

export class ExperimentFindOrCreateService {
  static create(experiments: ExperimentService): ExperimentFindOrCreateService {
    return new ExperimentFindOrCreateService(experiments);
  }

  private constructor(private readonly experiments: ExperimentService) {}

  /**
   * The experiment the slug names, created if it is free.
   *
   * Both identifiers are read, and the id wins where both are sent. The route
   * this replaces used to forward only the slug, so an id-only request passed
   * validation and then raised "Either experiment_id or experiment_slug is
   * required" as a 500; every caller now forwards both.
   */
  async resolve(input: ExperimentFindOrCreateInput): Promise<Experiment> {
    const projectId = input.projectId;
    let experiment: Experiment | null = null;

    if (input.experimentId) {
      experiment = await this.experiments.getById({ projectId, id: input.experimentId });
    }

    let slug: string | null = null;
    if (input.experimentSlug) {
      slug = ExperimentFindOrCreateService.slugify(input.experimentSlug);
      // `tryGetBySlug` filters `archivedAt` at the service layer. An archived
      // row also carries a `-archived-<nanoid>` slug, so it would not collide
      // even on a raw read — the lookup still goes through the service so the
      // archive rule stays one source of truth.
      experiment = await this.experiments.tryGetBySlug({ projectId, slug });
    }

    if (!experiment && !slug) {
      throw new Error("Either experiment_id or experiment_slug is required");
    }

    if (!experiment && slug) {
      return await this.experiments.save({
        id: `experiment_${nanoid()}`,
        name: input.experimentName ?? input.experimentSlug ?? slug,
        requestedSlug: slug,
        slugMode: "deduplicate",
        projectId,
        type: input.experimentType,
        workflowId: input.workflowId ?? null,
        workbenchState: null,
      });
    }

    if (!experiment) throw new Error("Experiment not found");

    // A name or a workflow sent with an EXISTING experiment updates it; the
    // slug is preserved, because it is already in the customer's URLs.
    if (input.experimentName ?? input.workflowId) {
      return await this.experiments.save({
        id: experiment.id,
        name: input.experimentName ?? experiment.name,
        requestedSlug: experiment.slug,
        slugMode: "preserve-existing",
        projectId,
        type: experiment.type,
        workflowId: input.workflowId ?? experiment.workflowId,
        workbenchState: experiment.workbenchState,
      });
    }

    return experiment;
  }

  /** The deployment's slug rule. See the four characters above. */
  private static slugify(value: string): string {
    return originalSlugify(value.replaceAll(/[:?&_]/g, "-"), {
      lower: true,
      strict: true,
      replacement: "-",
    });
  }
}
