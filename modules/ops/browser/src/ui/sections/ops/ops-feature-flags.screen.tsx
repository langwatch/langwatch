import { PageLayout } from "@langwatch/design-system/page-layout";

import { FeatureFlagsContent } from "../../../features/feature-flags/ui/sections/feature-flags-content.tsx";
import { FeatureFlagsOnly } from "./admin-screens.tsx";

export default function OpsFeatureFlagsScreen() {
  return (
    <FeatureFlagsOnly>
      <PageLayout.Header>
        <PageLayout.Heading>Feature flags</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container paddingY={5} maxWidth="full">
        <FeatureFlagsContent />
      </PageLayout.Container>
    </FeatureFlagsOnly>
  );
}
