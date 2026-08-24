import SubscriptionsView from "~/features/enterprise/admin/backoffice/resources/SubscriptionsView";
import BackofficeShell from "./_shell";

export default function BackofficeSubscriptionsPage() {
  return (
    <BackofficeShell>
      <SubscriptionsView />
    </BackofficeShell>
  );
}
