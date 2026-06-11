import { useEffect } from "react";

import { LoadingScreen } from "~/components/LoadingScreen";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRouter } from "~/utils/compat/next-router";

/**
 * The evaluation wizard was removed in favor of the evaluations workbench.
 * Any remaining links (including saved experiments) redirect there.
 */
export default function EvaluationWizardRedirect() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const slug =
    typeof router.query.slug === "string" ? router.query.slug : undefined;

  useEffect(() => {
    if (!project) return;
    void router.replace(
      `/${project.slug}/experiments/workbench${slug ? `/${slug}` : ""}`,
    );
  }, [project, router, slug]);

  return <LoadingScreen />;
}
