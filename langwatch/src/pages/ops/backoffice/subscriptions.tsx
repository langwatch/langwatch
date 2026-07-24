import BackofficeShell from "./_shell";
import SubscriptionsView from "../../../../ee/admin/backoffice/resources/SubscriptionsView";

export default function BackofficeSubscriptionsPage() {
  return (
    <BackofficeShell>
      <SubscriptionsView />
    </BackofficeShell>
  );
}
