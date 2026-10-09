import SelfHostedInstancesView from "../../../../ee/admin/backoffice/resources/SelfHostedInstancesView";
import BackofficeShell from "./_shell";

export default function BackofficeSelfHostedInstancesPage() {
  return (
    <BackofficeShell>
      <SelfHostedInstancesView />
    </BackofficeShell>
  );
}
