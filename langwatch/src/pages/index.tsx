import { useRouter } from "~/utils/compat/next-router";
import { useEffect } from "react";
import { LoadingScreen } from "../components/LoadingScreen";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";

export default function Index() {
  const { project, team } = useOrganizationTeamProject();
  const router = useRouter();

  useEffect(() => {
    if (project) {
      void router.replace(`/${project.slug}`);
    }
  }, [project, router, team]);

  return <LoadingScreen />;
}
