import { ExperimentType } from "@prisma/client";
import { useEffect, useRef } from "react";

import { LoadingScreen } from "~/components/LoadingScreen";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";

/**
 * The evaluation wizard was removed in favor of the evaluations workbench.
 * A brand-new evaluation opens the workbench directly. A saved experiment can
 * only open in the workbench if it is workbench-native (EVALUATIONS_V3 or a
 * legacy wizard run that carries workbenchState); older experiments predate
 * that data model, so they route to the workflow they were run from instead
 * of a workbench that cannot render them.
 */
export default function EvaluationWizardRedirect() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const hasRedirectedRef = useRef(false);
  const slug =
    typeof router.query.slug === "string" ? router.query.slug : undefined;

  const experiment = api.experiments.getExperimentBySlugOrId.useQuery(
    { projectId: project?.id ?? "", experimentSlug: slug ?? "" },
    { enabled: !!project && !!slug },
  );

  // Fire the redirect once: the compat router is a fresh object each render, so
  // without this guard the effect re-runs and re-fires replace every render.
  useEffect(() => {
    if (!project || hasRedirectedRef.current) return;

    // No slug: a brand-new evaluation, the workbench is the entry point.
    if (!slug) {
      hasRedirectedRef.current = true;
      void router.replace(`/${project.slug}/experiments/workbench`);
      return;
    }

    // With a slug we need the experiment to know where it can actually open.
    if (!experiment.isFetched) return;
    hasRedirectedRef.current = true;

    const data = experiment.data;
    const isWorkbenchNative =
      data?.type === ExperimentType.EVALUATIONS_V3 || !!data?.workbenchState;

    if (isWorkbenchNative) {
      void router.replace(`/${project.slug}/experiments/workbench/${slug}`);
    } else if (data?.workflowId) {
      void router.replace(`/${project.slug}/studio/${data.workflowId}`);
    } else {
      // No workflow to fall back to: the read-only experiment view still
      // renders legacy results.
      void router.replace(`/${project.slug}/experiments/${slug}`);
    }
  }, [project, router, slug, experiment.isFetched, experiment.data]);

  return <LoadingScreen />;
}
