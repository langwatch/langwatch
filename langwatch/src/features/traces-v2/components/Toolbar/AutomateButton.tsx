import { Box, Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { ArrowUpRight, Zap } from "lucide-react";
import {
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "~/components/ui/popover";
import { TriggerAnchor } from "~/components/ui/TriggerAnchor";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import NextLink from "~/utils/compat/next-link";

/**
 * Filtered traces → automation entry point.
 *
 * The legacy traces view let you turn an applied filter into a trigger
 * (Send Slack / Email / Add to dataset / Add to annotation queue). That
 * path is being rebuilt on top of the upcoming event-driven trigger
 * system, so we don't wire the new UI into the legacy `Trigger` shape.
 *
 * Until the new trigger system lands, this button surfaces the feature
 * (so users can find it where they expect) but explains that they need
 * to use the legacy traces view to create an automation. The button
 * intentionally reads as gated rather than hidden, so users discover
 * the affordance is coming.
 */
export const AutomateButton: React.FC<{ compact?: boolean }> = ({
  compact = false,
}) => {
  const { project, hasPermission } = useOrganizationTeamProject();

  if (!hasPermission("triggers:manage")) return null;

  const legacyHref = project?.slug ? `/${project.slug}/messages` : "/messages";

  return (
    <PopoverRoot positioning={{ placement: "bottom-end" }}>
      <Tooltip
        content="Automations from a filter. Coming soon."
        positioning={{ placement: "bottom" }}
      >
        <TriggerAnchor>
          <PopoverTrigger asChild>
            <Button
              size="xs"
              variant="ghost"
              aria-label="Create an automation from the current filter"
              // Read as gated, not missing — same pattern as the AskAi
              // primer state. Keeps the affordance discoverable.
              opacity={0.7}
              filter="saturate(0.7)"
            >
              <Icon boxSize={3.5}>
                <Zap />
              </Icon>
              {!compact && "Automate"}
            </Button>
          </PopoverTrigger>
        </TriggerAnchor>
      </Tooltip>
      <PopoverContent width="320px">
        <PopoverArrow />
        <PopoverBody>
          <VStack align="stretch" gap={3}>
            <HStack gap={2}>
              <Box
                display="flex"
                alignItems="center"
                justifyContent="center"
                boxSize={6}
                borderRadius="md"
                bg="orange.subtle"
                color="orange.fg"
              >
                <Zap size={14} />
              </Box>
              <Text textStyle="sm" fontWeight="semibold">
                Automations are moving
              </Text>
            </HStack>
            <Text textStyle="xs" color="fg.muted" lineHeight="1.5">
              In the old view you could turn a filter into an automation — Slack
              pings, dataset capture, annotation queues. We&rsquo;re rebuilding
              that on the new event-driven trigger system, and it&rsquo;s not
              wired up here yet. For now, create automations from the original
              trace view and they&rsquo;ll keep running against your data.
            </Text>
            <NextLink href={legacyHref} style={{ display: "block" }}>
              <Button size="xs" width="full" variant="outline">
                <Icon boxSize={3.5}>
                  <ArrowUpRight />
                </Icon>
                Set up automations (original view)
              </Button>
            </NextLink>
          </VStack>
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
};
