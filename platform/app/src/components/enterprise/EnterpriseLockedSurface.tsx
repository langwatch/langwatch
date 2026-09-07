import { Box, Button, Heading, Skeleton, Text, VStack } from "@chakra-ui/react";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";

import { useActivePlan } from "~/hooks/useActivePlan";

interface Props {
  children: ReactNode;
  featureName: string;
  description?: string;
}

/**
 * Full-page enterprise gate. Renders children when the active plan is
 * Enterprise; otherwise renders an upsell card with a link to the
 * subscription page. Skeleton during plan-load to avoid flashing the
 * gate before the actual tier resolves.
 */
export function EnterpriseLockedSurface({
  children,
  featureName,
  description,
}: Props) {
  const { isEnterprise, isLoading } = useActivePlan();

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
