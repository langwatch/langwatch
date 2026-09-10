/**
 * Binds the LangWatchQL-over-REST declaration to this process's `/api/v1/query`
 * door. The three collaborators are the SAME ones the saved-chart family is
 * mounted with, minus the feature flag and the dashboard: this door has no
 * rollout switch of its own and no saved charts, so a statement it can run is
 * never gated a second time by the workbench's experiment.
 *
 * @see ./langwatch-ql-rest.mount.ts — the saved-chart half of the same graph
 */
import type { LangWatchQLCaller, LangWatchQLProtections } from "@langwatch/analytics-contract";
import {
  langWatchQLCallerProtections,
  queryRest,
  type AnalyticsQueryApi,
  type LangWatchQLService,
} from "@langwatch/analytics-server";
import {
  bindRestMiddleware,
  credentialPrincipalOfToken,
  type MountableRestApp,
  type RestCredentialPrincipal,
} from "@langwatch/api/rest";
import { NotFoundError } from "@langwatch/handled-error";
import type { ProjectApi } from "@langwatch/project-contract";

import { ApiRestObservabilityComposition } from "../../app/api-rest-observability.composition.ts";
import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/**
 * This family answers the canonical `{ code, message, meta }` envelope, not
 * the flat legacy body the process falls back to — the same envelope the
 * saved-chart family's mount publishes, off the same restricted runner.
 */
const canonicalErrors = ApiRestObservabilityComposition.create().canonicalErrorHandler;

/**
 * What the query door reaches: the project directory a credential's project id
 * resolves through, the restricted statement runner, and what a caller's
 * content protections resolve to for one project. Shared with the saved-chart
 * family's mount, which reads the same three off {@link module:app-production}
 * (plus the feature flag this door has no use for).
 */
export type ApiQueryRestCollaborators = Readonly<{
  projects: () => ProjectApi;
  langWatchQL: () => LangWatchQLService;
  protectionsFor: (input: {
    projectId: string;
    credential: RestCredentialPrincipal;
  }) => Promise<LangWatchQLProtections>;
}>;

/** `/api/v1/query`, bound to this process's graph. */
export function mountQueryRest(
  runtime: ApiRestRuntime,
  options: Readonly<{ collaborators: ApiQueryRestCollaborators }>,
): MountableRestApp {
  const app: AnalyticsQueryApi = {
    runCallerFor: async ({ projectId }): Promise<LangWatchQLCaller> => {
      const project = await options.collaborators.projects().tryGetById(projectId);
      if (!project) throw new NotFoundError("project_not_found", "Project", projectId);

      return { id: project.id, lwqlKey: project.lwqlKey };
    },
    describeSchema: (input) => options.collaborators.langWatchQL().describeSchema(input),
    execute: (input) => options.collaborators.langWatchQL().execute(input),
  };

  return runtime.mount(queryRest.router(), () => app, {
    onError: canonicalErrors,
    facts: [
      bindRestMiddleware(langWatchQLCallerProtections, (context) => {
        const credential = runtime.projectCredentialOf(context.req.raw);

        return options.collaborators.protectionsFor({
          projectId: credential.project.id,
          credential: credentialPrincipalOfToken(credential),
        });
      }),
    ],
  });
}
