import { Button } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
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
  "by-session": "By Session",
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
        <Button size="xs" variant="outline" fontWeight="normal">
          Group: {GROUPING_OPTIONS[grouping]}
          <ChevronDown size={12} />
        </Button>
      </MenuTrigger>
      <MenuContent minWidth="120px" textStyle="xs" paddingY={1}>
        <MenuRadioItemGroup
          value={grouping}
          onValueChange={(e) => setGrouping(e.value as GroupingMode)}
        >
          {Object.entries(GROUPING_OPTIONS).map(([value, label]) => (
            <MenuRadioItem
              key={value}
              value={value}
              fontSize="xs"
              paddingY={1}
            >
              {label}
            </MenuRadioItem>
          ))}
        </MenuRadioItemGroup>
      </MenuContent>
    </MenuRoot>
  );
};
