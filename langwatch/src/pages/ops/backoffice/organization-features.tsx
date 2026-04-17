import BackofficeShell from "./_shell";
import OrganizationFeaturesView from "../../../../ee/admin/backoffice/resources/OrganizationFeaturesView";

export default function BackofficeOrganizationFeaturesPage() {
  return (
    <BackofficeShell>
      <OrganizationFeaturesView />
    </BackofficeShell>
  );
}
