import { Box, Circle, HStack, Text, type StackProps } from "@chakra-ui/react";
import { LuX } from "react-icons/lu";
import { VersionBadge } from "~/prompt-configs/components/ui/VersionBadge";
import { OrganizationBadge } from "~/prompt-configs/components/ui/OrganizationBadge";
import { withController } from "~/utils/withControllerHOC";
import { usePromptBrowserTabController } from "./usePromptBrowserTabController";

interface PromptBrowserTabProps extends StackProps {
  dimmed?: boolean;
}

type PromptBrowserTabControllerProps = ReturnType<
  typeof usePromptBrowserTabController
>;

/**
 * PromptBrowserTabView
 * Single Responsibility: Renders a browser tab with title, version badge, organization badge, unsaved changes indicator, and close button.
 */
function PromptBrowserTabView({
  tab,
  hasUnsavedChanges,
  dimmed,
  handleClose,
  ...rest
}: PromptBrowserTabProps & PromptBrowserTabControllerProps) {
  if (!tab) return null;
  const meta = tab.data.meta;

  return (
    <HStack gap={2} height="full" {...rest}>
      <HStack>
        <Text textOverflow="ellipsis" whiteSpace="nowrap" overflow="hidden">
          {meta.title ?? "Untitled"}
        </Text>
        {hasUnsavedChanges ? (
          <Box>
            <Circle size="10px" bg="orange.400" color="gray.50" />
          </Box>
        ) : meta.versionNumber != null ? (
          <VersionBadge version={meta.versionNumber ?? 0} />
        ) : null}
        {meta.scope === "ORGANIZATION" && <OrganizationBadge />}
      </HStack>
      <Box
        role="button"
        borderRadius="3px"
        transition="all 0.1s ease-in-out"
        opacity={dimmed ? 0.25 : 1}
        _hover={{ opacity: 1 }}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onClick={handleClose}
      >
        <LuX width="18px" />
      </Box>
    </HStack>
  );
}

export const PromptBrowserTab = withController(
  PromptBrowserTabView,
  usePromptBrowserTabController,
);
