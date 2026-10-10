import { useRouter } from "@langwatch/browser-host/use-router";
import { useEffect } from "react";

import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";
import { LoadingScreen } from "../../../ui/blocks/loading-screen.tsx";

export default function Onboarding() {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();

  useEffect(() => {
    if (project) {
      void router.push(`/${project.slug}`);
    }
  }, [project, router]);

  return <LoadingScreen />;
}
