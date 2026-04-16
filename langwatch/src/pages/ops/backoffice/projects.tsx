import BackofficeShell from "./_shell";
import ProjectsView from "~/components/ops/backoffice/resources/ProjectsView";

export default function BackofficeProjectsPage() {
  return (
    <BackofficeShell>
      <ProjectsView />
    </BackofficeShell>
  );
}
