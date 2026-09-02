import { useEffect } from "react";
import { useRouter } from "../../behavior/next-router";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project";
import { LoadingScreen } from "../../components/LoadingScreen";

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
