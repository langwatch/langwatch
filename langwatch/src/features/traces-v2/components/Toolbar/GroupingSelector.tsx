import { Box, Button, Text } from "@chakra-ui/react";
import { ChevronDown, Layers } from "lucide-react";
import type React from "react";
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

export const GroupingSelector: React.FC = () => {
  const grouping = useViewStore((s) => s.grouping);
  const setGrouping = useViewStore((s) => s.setGrouping);

  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <Button
          size="xs"
          variant={grouping === "flat" ? "outline" : "subtle"}
          aria-label={`Group rows — currently ${GROUPING_OPTIONS[grouping]}`}
          gap={1}
          paddingX={2}
        >
          <Layers size={14} />
          <ChevronDown size={12} />
        </Button>
      </MenuTrigger>
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
