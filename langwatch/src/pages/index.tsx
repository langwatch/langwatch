import { useEffect } from "react";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { useRouter } from "next/router";
import { LoadingScreen } from "../components/LoadingScreen";

export default function Index() {
  const { project, team } = useOrganizationTeamProject();
  const router = useRouter();

  useEffect(() => {
    if (project) {
      void router.push(`/${project.slug}`);
    }

    if (team && !project) {
      if (team.projects[0]) {
        void router.push(`/${team.projects[0].slug}`);
      } else {
        void router.push(`/onboarding/${team.slug}/project`);
      }
    }
  }, [project, router, team]);

  return <LoadingScreen />;
}
