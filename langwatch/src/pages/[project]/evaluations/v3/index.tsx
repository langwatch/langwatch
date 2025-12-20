import { generate } from "@langwatch/ksuid";
import { useRouter } from "next/router";
import { useEffect } from "react";

import { LoadingScreen } from "~/components/LoadingScreen";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

/**
 * New Evaluation V3 Page
 *
 * Redirects to a new evaluation with a generated slug.
 * Uses ksuid for consistent ID generation across frontend and backend.
 */
export default function NewEvaluationV3() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  useEffect(() => {
    if (project) {
      // Generate a short slug (last 8 chars of ksuid for clean URLs)
      const fullId = generate("eval").toString();
      const slug = fullId.slice(-8);
      void router.replace(`/${project.slug}/evaluations/v3/${slug}`);
    }
  }, [project, router]);

  return <LoadingScreen />;
}
