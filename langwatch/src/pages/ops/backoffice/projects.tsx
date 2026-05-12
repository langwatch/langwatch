import BackofficeShell from "./_shell";
import ProjectsView from "../../../../ee/admin/backoffice/resources/ProjectsView";

export default function BackofficeProjectsPage() {
  return (
    <BackofficeShell>
      <ProjectsView />
    </BackofficeShell>
  );
}
