import ProjectsView from "~/features/enterprise/admin/backoffice/resources/ProjectsView";
import BackofficeShell from "./_shell";

export default function BackofficeProjectsPage() {
  return (
    <BackofficeShell>
      <ProjectsView />
    </BackofficeShell>
  );
}
