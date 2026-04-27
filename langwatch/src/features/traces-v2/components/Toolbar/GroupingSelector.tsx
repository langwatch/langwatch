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
import { useViewStore } from "../../stores/viewStore";
import type { GroupingMode } from "../../stores/viewStore";

const GROUPING_OPTIONS: { value: GroupingMode; label: string }[] = [
  { value: "flat", label: "Flat" },
  { value: "by-session", label: "By Session" },
  { value: "by-service", label: "By Service" },
  { value: "by-user", label: "By User" },
  { value: "by-model", label: "By Model" },
];

export const GroupingSelector: React.FC = () => {
  const grouping = useViewStore((s) => s.grouping);
  const setGrouping = useViewStore((s) => s.setGrouping);

  const current = GROUPING_OPTIONS.find((o) => o.value === grouping);

  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <Button size="xs" variant="outline" fontWeight="normal">
          Group: {current?.label ?? "Flat"}
          <ChevronDown size={12} />
        </Button>
      </MenuTrigger>
      <MenuContent minWidth="120px" textStyle="xs" paddingY={1}>
        <MenuRadioItemGroup
          value={grouping}
          onValueChange={(e) => setGrouping(e.value as GroupingMode)}
        >
          {GROUPING_OPTIONS.map((opt) => (
            <MenuRadioItem
              key={opt.value}
              value={opt.value}
              fontSize="xs"
              paddingY={1}
            >
              {opt.label}
            </MenuRadioItem>
          ))}
        </MenuRadioItemGroup>
      </MenuContent>
    </MenuRoot>
  );
};
