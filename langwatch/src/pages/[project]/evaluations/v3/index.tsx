import { useRouter } from "next/router";
import { useEffect } from "react";
import { nanoid } from "nanoid";

import { LoadingScreen } from "~/components/LoadingScreen";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

/**
 * New Evaluation V3 Page
 *
 * Redirects to a new evaluation with a generated slug.
 */
export default function NewEvaluationV3() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  useEffect(() => {
    if (project) {
      // Generate a new slug and redirect
      const slug = `eval-${nanoid(8)}`;
      void router.replace(`/${project.slug}/evaluations/v3/${slug}`);
    }
  }, [project, router]);

  return <LoadingScreen />;
}
