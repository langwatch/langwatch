import SsoConnectionsView from "~/components/ops/backoffice/resources/SsoConnectionsView";
import BackofficeShell from "./_shell";

export default function BackofficeSsoConnectionsPage() {
  return (
    <BackofficeShell>
      <SsoConnectionsView />
    </BackofficeShell>
  );
}
