import { PageLayout } from "@langwatch/design-system/page-layout";

import { FeatureFlagsContent } from "../../../features/feature-flags/ui/sections/feature-flags-content.tsx";
import { CloudOnly } from "./admin-screens.tsx";

export default function OpsFeatureFlagsScreen() {
  return (
    <CloudOnly>
      <PageLayout.Header>
        <PageLayout.Heading>Feature Flags</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container>
        <FeatureFlagsContent />
      </PageLayout.Container>
    </CloudOnly>
  );
}
