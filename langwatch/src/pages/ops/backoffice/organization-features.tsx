import BackofficeShell from "./_shell";
import OrganizationFeaturesView from "~/components/ops/backoffice/resources/OrganizationFeaturesView";

export default function BackofficeOrganizationFeaturesPage() {
  return (
    <BackofficeShell>
      <OrganizationFeaturesView />
    </BackofficeShell>
  );
}
