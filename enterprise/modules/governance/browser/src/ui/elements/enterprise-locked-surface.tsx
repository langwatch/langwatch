import { EnterpriseLock } from "@langwatch/browser-host/enterprise-lock";
import { Box, Skeleton, VStack } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import { useGovernanceHost } from "../../model/governance-host.ts";

interface Props {
  children: ReactNode;
  featureName: string;
  description: string;
}

/**
 * Full-page enterprise gate: renders children on the Enterprise plan, otherwise the shared
 * Enterprise lock. Skeleton during plan-load to avoid flashing the gate before the tier resolves.
 */
export function EnterpriseLockedSurface({ children, featureName, description }: Props) {
  const host = useGovernanceHost();
  const { isEnterprise, isLoading } = host.plan();

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
      <Box maxWidth="640px" marginX="auto" marginY={12}>
        <EnterpriseLock
          feature={featureName}
          description={description}
          canManage={host.hasPermission("organization:manage")}
          canSeePlans={host.hasPermission("organization:view")}
          data-testid="governance-enterprise-lock"
        />
      </Box>
    </Box>
  );
}
