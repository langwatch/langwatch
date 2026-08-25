import BugReportsView from "~/components/ops/backoffice/resources/BugReportsView";
import BackofficeShell from "./_shell";

export default function BackofficeBugReportsPage() {
  return (
    <BackofficeShell>
      <BugReportsView />
    </BackofficeShell>
  );
}
