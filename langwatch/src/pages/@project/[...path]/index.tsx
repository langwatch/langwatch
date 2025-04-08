import { useRouter } from "next/router";
import { LoadingScreen } from "../../../components/LoadingScreen";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { useEffect } from "react";

export default function AtProjectRedirect() {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const { path } = router.query;

  useEffect(() => {
    // If it can't find any projects in time, redirect to the home page
    const timeout = setTimeout(() => {
      void router.push(`/`);
    }, 5_000);

    if (project && Array.isArray(path)) {
      clearTimeout(timeout);
      void router.push(`/${project.slug}/${path.join("/")}`);
    }

    return () => clearTimeout(timeout);
  }, [path, project, router]);

  return <LoadingScreen />;
}
