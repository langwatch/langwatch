import { PageLayout } from "@langwatch/design-system/page-layout";
import { FeatureFlagsContent } from "../../features/feature-flags/ui/sections/feature-flags-content";

export default function OpsFeatureFlagsScreen() {
  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Feature Flags</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container>
        <FeatureFlagsContent />
      </PageLayout.Container>
    </>
  );
}
