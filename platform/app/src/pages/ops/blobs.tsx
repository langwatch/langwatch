import { DashboardLayout } from "~/components/DashboardLayout";
import { BlobStoreContent } from "~/components/ops/blobs";
import { OpsPageShell } from "~/components/ops/shared/OpsPageShell";
import { PageLayout } from "~/components/ui/layouts/PageLayout";

export default function OpsBlobsPage() {
  return (
    <OpsPageShell>
      <DashboardLayout>
        <PageLayout.Header>
          <PageLayout.Heading>Payload store</PageLayout.Heading>
        </PageLayout.Header>
        <PageLayout.Container>
          <BlobStoreContent />
        </PageLayout.Container>
      </DashboardLayout>
    </OpsPageShell>
  );
}
