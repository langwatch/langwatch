import BackofficeShell from "./_shell";
import OrganizationsView from "~/components/ops/backoffice/resources/OrganizationsView";

export default function BackofficeOrganizationsPage() {
  return (
    <BackofficeShell>
      <OrganizationsView />
    </BackofficeShell>
  );
}
