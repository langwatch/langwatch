import SsoConnectionsView from "../../../../ee/admin/backoffice/resources/SsoConnectionsView";
import BackofficeShell from "./_shell";

export default function BackofficeSsoConnectionsPage() {
  return (
    <BackofficeShell>
      <SsoConnectionsView />
    </BackofficeShell>
  );
}
