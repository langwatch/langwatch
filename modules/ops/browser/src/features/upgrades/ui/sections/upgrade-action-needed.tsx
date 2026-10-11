/**
 * Home's "Action needed for updates" card: the join requests card's shape in warning colours,
 * first on Home, for ops:view holders while an operator step of this version is unfinished.
 * Spec: modules/ops/specs/upgrades.feature
 */
import { Link } from "@langwatch/browser-host/link";
import {
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Spacer,
  Text,
} from "@langwatch/design-system/primitives";
import { ArrowRight, Wrench } from "lucide-react";

import { useOpsPermission } from "../../../../behavior/ops-session.ts";
import { useUnfinishedOperatorSteps } from "../../behavior/use-unfinished-operator-steps.ts";

export function UpgradeActionNeeded() {
  const { hasAccess } = useOpsPermission();
  const steps = useUnfinishedOperatorSteps({ enabled: hasAccess });

  if (!hasAccess || steps.length === 0) return null;

  return (
    <Box width="full" data-testid="home-upgrade-action-needed">
      <Card.Root
        bg="bg.warning"
        borderWidth="1px"
        borderColor="border.warning"
        borderRadius="14px"
        boxShadow="none"
      >
        <Card.Body padding={4} gap={3}>
          <HStack gap={2}>
            <Box color="fg.warning" display="flex" alignItems="center">
              <Wrench size={16} aria-hidden />
            </Box>
            <Heading as="h3" size="sm">
              Action needed for updates
            </Heading>
            <Text fontSize="sm" color="fg.muted">
              {steps.length === 1
                ? "One operator step of this version is not finished."
                : `${steps.length} operator steps of this version are not finished.`}
            </Text>
            <Spacer />
            <Link href="/ops/upgrades">
              <Button size="xs" variant="ghost" color="fg.muted">
                Open Upgrades
                <ArrowRight size={14} aria-hidden />
              </Button>
            </Link>
          </HStack>
        </Card.Body>
      </Card.Root>
    </Box>
  );
}
