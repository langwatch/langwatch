import { Box, Button, Heading, Skeleton, Text, VStack } from "@chakra-ui/react";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";

import { useGovernanceHost } from "../../model/governance-host.ts";
interface Props {
  children: ReactNode;
  featureName: string;
  description?: string;
}

/**
 * Full-page enterprise gate: renders children on the Enterprise plan,
 * otherwise an upsell card linking to the subscription page. Skeleton
 * during plan-load to avoid flashing the gate before the tier resolves.
 */
export function EnterpriseLockedSurface({ children, featureName, description }: Props) {
  const { isEnterprise, isLoading } = useGovernanceHost().plan();

  if (isLoading) {
    return (
      <VStack align="stretch" gap={4} padding={8}>
        <Skeleton height="32px" width="240px" />
        <Skeleton height="120px" />
        <Skeleton height="200px" />
      </VStack>
    );
  }

  if (isEnterprise) {
    return <>{children}</>;
  }

  return (
    <Box padding={8}>
      <Box
        maxWidth="640px"
        marginX="auto"
        marginY={12}
        padding={8}
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="lg"
        backgroundColor="bg.subtle"
      >
        <VStack align="start" gap={4}>
          <Box color="fg.muted">
            <Lock size={32} />
          </Box>
          <Heading as="h2" size="lg">
            {featureName}
          </Heading>
          <Text color="fg.muted" fontSize="sm">
            {description ??
              `${featureName} is available on Enterprise plans. Upgrade to unlock this surface for your organization.`}
          </Text>
          <Button asChild size="sm" colorPalette="orange">
            <a href="/settings/subscription">Upgrade →</a>
          </Button>
        </VStack>
      </Box>
    </Box>
  );
}
