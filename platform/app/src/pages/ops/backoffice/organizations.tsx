import OrganizationsView from "~/components/ops/backoffice/resources/OrganizationsView";
import BackofficeShell from "./_shell";

export default function BackofficeOrganizationsPage() {
  return (
    <BackofficeShell>
      <OrganizationsView />
    </BackofficeShell>
  );
}
