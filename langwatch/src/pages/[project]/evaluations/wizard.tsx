import { useEffect, useRef } from "react";

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
  const hasRedirectedRef = useRef(false);
  const slug =
    typeof router.query.slug === "string" ? router.query.slug : undefined;

  // Fire the redirect once: the compat router is a fresh object each render, so
  // without this guard the effect re-runs and re-fires replace every render.
  useEffect(() => {
    if (!project || hasRedirectedRef.current) return;
    hasRedirectedRef.current = true;
    void router.replace(
      `/${project.slug}/experiments/workbench${slug ? `/${slug}` : ""}`,
    );
  }, [project, router, slug]);

  return <LoadingScreen />;
}
