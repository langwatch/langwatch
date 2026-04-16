import BackofficeShell from "./_shell";
import SubscriptionsView from "~/components/ops/backoffice/resources/SubscriptionsView";

export default function BackofficeSubscriptionsPage() {
  return (
    <BackofficeShell>
      <SubscriptionsView />
    </BackofficeShell>
  );
}
