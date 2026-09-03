import { useEffect, useRef } from "react";
import { LoadingScreen } from "@langwatch/design-system/loading-screen";
import { ExperimentType } from "../../model/prisma-types";
import { useOrganizationTeamProject } from "@langwatch/workflow-web/studio-host/use-organization-team-project";
import { api } from "@langwatch/workflow-web/studio-host/api";
import { useRouter } from "@langwatch/workflow-web/studio-host/next-router";

/**
 * Redirects to the workbench when workbench-native (EVALUATIONS_V3 or a
 * legacy run carrying workbenchState); otherwise to the workflow it ran from.
 */
export default function EvaluationWizardRedirect() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const hasRedirectedRef = useRef(false);
  const slug = typeof router.query.slug === "string" ? router.query.slug : undefined;

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
