import {
  Box,
  Button,
  Flex,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Cable, X } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useProjectHasTraces } from "../../hooks/useProjectHasTraces";
import { useOnboardingStore } from "../store/onboardingStore";
import { IntegrateDrawer } from "./IntegrateDrawer";

/**
 * 14-day snooze window in milliseconds. After this period the card
 * reappears on next mount so users who deferred integration get a
 * reminder.
 */
const SNOOZE_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Returns true when the integration CTA card should be visible for the
 * given project. Conditions:
 *   - project has no real traces yet
 *   - card has not been dismissed within the last 14 days
 */
export function useIntegrationCTAVisible({
  projectId,
}: {
  projectId: string | undefined;
}): boolean {
  const { hasAnyTraces } = useProjectHasTraces();
  const dismissedAt = useOnboardingStore((s) =>
    projectId
      ? (s.integrationCtaDismissedAtByProject[projectId] ?? null)
      : null,
  );

  if (!projectId) return false;
  if (hasAnyTraces !== false) return false;

  if (dismissedAt !== null) {
    const elapsed = Date.now() - dismissedAt;
    if (elapsed < SNOOZE_DURATION_MS) return false;
  }

  return true;
}

/**
 * Inline CTA card that sits in the trace table area when the project has
 * no real traces. Encourages the user to integrate their code without
 * replacing the table — sample data rows are visible behind/below it.
 *
 * Dismissed state is persisted per-project with a 14-day snooze so the
 * card reappears as a reminder. Clicking "Integrate" opens the full
 * `IntegrateDrawer`.
 */
export const IntegrationCTACard: React.FC = () => {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;
  const visible = useIntegrationCTAVisible({ projectId });
  const setDismissedAt = useOnboardingStore(
    (s) => s.setIntegrationCtaDismissedAt,
  );

  const [drawerOpen, setDrawerOpen] = useState(false);

  if (!visible || !projectId) return null;

  function handleDismiss(): void {
    if (!projectId) return;
    setDismissedAt(projectId, Date.now());
  }

  return (
    <>
      <Box
        borderWidth="1px"
        borderColor="orange.muted"
        borderRadius="lg"
        bg="orange.subtle"
        paddingX={5}
        paddingY={4}
        marginX={4}
        marginY={3}
        role="region"
        aria-label="Integrate your code"
        data-testid="integration-cta-card"
      >
        <Flex align="flex-start" justify="space-between" gap={3}>
          <HStack align="flex-start" gap={3} flex={1}>
            <Icon
              as={Cable}
              boxSize={5}
              color="orange.fg"
              flexShrink={0}
              marginTop={0.5}
            />
            <VStack align="stretch" gap={2} flex={1}>
              <Text
                textStyle="sm"
                fontWeight="semibold"
                color="fg"
                lineHeight="snug"
              >
                Integrate your code to see real traces here
              </Text>
              <Text textStyle="xs" color="fg.muted" lineHeight="tall">
                The rows below are sample data. Send your own traces by
                connecting the LangWatch SDK, MCP server, or a coding agent
                skill.
              </Text>
              <HStack gap={2} paddingTop={1}>
                <Button
                  size="xs"
                  colorPalette="orange"
                  variant="surface"
                  onClick={() => setDrawerOpen(true)}
                >
                  Integrate
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  color="fg.muted"
                  onClick={handleDismiss}
                >
                  Remind me later
                </Button>
              </HStack>
            </VStack>
          </HStack>
          <Button
            size="2xs"
            variant="ghost"
            color="fg.subtle"
            aria-label="Dismiss integration prompt"
            onClick={handleDismiss}
            flexShrink={0}
          >
            <X size={12} />
          </Button>
        </Flex>
      </Box>

      <IntegrateDrawer
        open={drawerOpen}
        onOpenChange={(open) => setDrawerOpen(open)}
      />
    </>
  );
};
