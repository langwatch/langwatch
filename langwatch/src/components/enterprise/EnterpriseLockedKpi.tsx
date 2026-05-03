import { Box, Button, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";

import { useActivePlan } from "~/hooks/useActivePlan";

interface Props {
  children: ReactNode;
  featureName: string;
}

/**
 * Single-tile enterprise gate for inline KPI / dashboard cards.
 * Renders children on Enterprise, otherwise renders a compact locked tile.
 */
export function EnterpriseLockedKpi({ children, featureName }: Props) {
  const { isEnterprise, isLoading } = useActivePlan();

  if (isLoading) {
    return <Skeleton height="100px" borderRadius="md" />;
  }

  if (isEnterprise) {
    return <>{children}</>;
  }

  return (
    <Box
      padding={4}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      backgroundColor="bg.subtle"
      height="100%"
    >
      <VStack align="start" gap={2}>
        <HStack color="fg.muted">
          <Lock size={14} />
          <Text fontSize="xs" textTransform="uppercase" letterSpacing="wider">
            Enterprise
          </Text>
        </HStack>
        <Text fontSize="sm" fontWeight="medium">
          {featureName}
        </Text>
        <Button asChild size="xs" variant="outline">
          <a href="/settings/subscription">Upgrade</a>
        </Button>
      </VStack>
    </Box>
  );
}
