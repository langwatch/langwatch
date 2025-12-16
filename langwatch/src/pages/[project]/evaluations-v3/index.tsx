/**
 * Evaluations V3 Index
 *
 * Redirects to create a new evaluation.
 */

import { useRouter } from "next/router";
import { useEffect } from "react";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { DashboardLayout } from "../../../components/DashboardLayout";
import { Skeleton, VStack } from "@chakra-ui/react";

function EvaluationsV3Index() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  useEffect(() => {
    if (project) {
      void router.replace(`/${project.slug}/evaluations-v3/new`);
    }
  }, [project, router]);

  return (
    <DashboardLayout>
      <VStack width="full" padding={8}>
        <Skeleton height="60px" width="full" />
        <Skeleton height="400px" width="full" />
      </VStack>
    </DashboardLayout>
  );
}

export default EvaluationsV3Index;

