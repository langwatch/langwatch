import { Box, Button, Text } from "@chakra-ui/react";
import { ChevronDown, Layers } from "lucide-react";
import type React from "react";
import { Tooltip } from "~/components/ui/tooltip";
import {
  MenuContent,
  MenuRadioItem,
  MenuRadioItemGroup,
  MenuRoot,
  MenuTrigger,
} from "../../../../components/ui/menu";
import type { GroupingMode } from "../../stores/viewStore";
import { useViewStore } from "../../stores/viewStore";

const GROUPING_OPTIONS: Record<GroupingMode, string> = {
  flat: "Flat",
  "by-conversation": "By Conversation",
  "by-service": "By Service",
  "by-user": "By User",
  "by-model": "By Model",
};

export const GroupingSelector: React.FC<{ compact?: boolean }> = ({
  compact = false,
}) => {
  const grouping = useViewStore((s) => s.grouping);
  const setGrouping = useViewStore((s) => s.setGrouping);

  return (
    <MenuRoot>
      <Tooltip
        content={
          grouping === "flat"
            ? "Group rows"
            : `Grouped: ${GROUPING_OPTIONS[grouping]}`
        }
        positioning={{ placement: "bottom" }}
      >
        {/* The intermediate span keeps Tooltip's own asChild clone off the
            MenuTrigger's DOM node — nesting two asChild triggers directly
            (Tooltip > MenuTrigger) makes Tooltip's `id` clobber the one
            Zag's menu machine assigned to the button, breaking its
            id-based anchor lookup and pinning the menu at the page origin. */}
        <Box as="span" display="inline-flex">
          <MenuTrigger asChild>
            <Button
              size="xs"
              variant={grouping === "flat" ? "outline" : "subtle"}
              aria-label={`Group rows. Currently ${GROUPING_OPTIONS[grouping]}.`}
              gap={1}
              paddingX={2}
            >
              <Layers size={14} />
              {!compact && <ChevronDown size={12} />}
            </Button>
          </MenuTrigger>
        </Box>
      </Tooltip>
      <MenuContent minWidth="160px" textStyle="xs" paddingY={1}>
        <Box
          paddingX={3}
          paddingY={2}
          borderBottomWidth="1px"
          borderColor="border.subtle"
        >
          <Text
            textStyle="2xs"
            fontWeight="semibold"
            color="fg.muted"
            textTransform="uppercase"
            letterSpacing="0.06em"
          >
            Group by
          </Text>
        </Box>
        <MenuRadioItemGroup
          value={grouping}
          onValueChange={(e) => setGrouping(e.value as GroupingMode)}
        >
          {Object.entries(GROUPING_OPTIONS).map(([value, label]) => (
            <MenuRadioItem key={value} value={value} fontSize="xs" paddingY={1}>
              {label}
            </MenuRadioItem>
          ))}
        </MenuRadioItemGroup>
      </MenuContent>
    </MenuRoot>
  );
};
