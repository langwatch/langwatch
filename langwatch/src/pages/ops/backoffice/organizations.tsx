import BackofficeShell from "./_shell";
import OrganizationsView from "../../../../ee/admin/backoffice/resources/OrganizationsView";

export default function BackofficeOrganizationsPage() {
  return (
    <BackofficeShell>
      <OrganizationsView />
    </BackofficeShell>
  );
}
