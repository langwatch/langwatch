import BugReportsView from "~/features/enterprise/admin/backoffice/resources/BugReportsView";
import BackofficeShell from "./_shell";

export default function BackofficeBugReportsPage() {
  return (
    <BackofficeShell>
      <BugReportsView />
    </BackofficeShell>
  );
}
