// The title of every Braids page: the feature's mark, its name and the Enterprise chip.

import { EnterpriseBadge } from "@langwatch/design-system/enterprise-badge";
import { FeatureMark } from "@langwatch/design-system/feature-mark";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { HStack } from "@langwatch/design-system/primitives";

export function BraidsTitle() {
  return (
    <HStack gap={2}>
      <FeatureMark feature="braids" size={20} />
      <PageLayout.Heading>Braids</PageLayout.Heading>
      <EnterpriseBadge />
    </HStack>
  );
}
