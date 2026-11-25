/**
 * Home's "Action needed for updates" card, first on Home: ops:view holders while an operator step
 * is unfinished; every member on self-hosted, without a link, when the last update needs attention.
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
import { useUpgradeAttentionNotice } from "../../behavior/use-upgrade-attention-notice.ts";

const ATTENTION_NOTICE =
  "LangWatch's last update needs attention. Contact your LangWatch operator.";

function lineOf({ operatorSteps, count }: { operatorSteps: boolean; count: number }) {
  if (!operatorSteps) return ATTENTION_NOTICE;
  if (count === 1) return "One operator step of this version is not finished.";
  return `${count} operator steps of this version are not finished.`;
}

export function UpgradeActionNeeded() {
  const { hasAccess } = useOpsPermission();
  const steps = useUnfinishedOperatorSteps({ enabled: hasAccess });

  const attention = useUpgradeAttentionNotice();
  const operatorSteps = hasAccess && steps.length > 0;

  if (!operatorSteps && !attention) return null;

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
              {lineOf({ operatorSteps, count: steps.length })}
            </Text>
            <Spacer />
            {hasAccess && (
              <Link href="/ops/upgrades">
                <Button size="xs" variant="ghost" color="fg.muted">
                  Open Upgrades
                  <ArrowRight size={14} aria-hidden />
                </Button>
              </Link>
            )}
          </HStack>
        </Card.Body>
      </Card.Root>
    </Box>
  );
}
