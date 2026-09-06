import BugReportsView from "../../../../ee/admin/backoffice/resources/BugReportsView";
import BackofficeShell from "./_shell";

export default function BackofficeBugReportsPage() {
  return (
    <BackofficeShell>
      <BugReportsView />
    </BackofficeShell>
  );
}
