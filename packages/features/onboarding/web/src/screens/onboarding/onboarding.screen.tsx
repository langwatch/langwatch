import { useEffect } from "react";
import { useRouter } from "@langwatch/ui-host/use-router";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project.ts";
import { LoadingScreen } from "../../ui/blocks/loading-screen.tsx";

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
