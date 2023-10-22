import { useEffect } from "react";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { useRouter } from "next/router";
import { LoadingScreen } from "../components/LoadingScreen";

export default function Index() {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();

  useEffect(() => {
    if (project) {
      void router.push(`/${project.slug}`);
    }
  }, [project, router]);

  return <LoadingScreen />;
}
