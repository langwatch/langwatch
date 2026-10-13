import { Menu } from "@langwatch/design-system/menu";
import { Button } from "@langwatch/design-system/primitives";
import { LuCheck, LuEllipsis, LuListTree } from "react-icons/lu";

import { useFilterToggle } from "../../behavior/use-filter-toggle.ts";

/** The header's overflow: the rarer controls, with "Negate filters" only while a filter is set. */
export function AnalyticsOverflowMenu({ onShowTraces }: { onShowTraces?: () => void }) {
  const { filterParams, hasAnyFilters, setNegateFilters } = useFilterToggle();
  const showNegate = hasAnyFilters;
  if (!onShowTraces && !showNegate) return null;

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button size="sm" variant="ghost" aria-label="More analytics actions">
          <LuEllipsis aria-hidden="true" />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        {onShowTraces && (
          <Menu.Item value="show-traces" onClick={onShowTraces}>
            <LuListTree aria-hidden="true" /> Show traces
          </Menu.Item>
        )}
        {showNegate && (
          <Menu.Item
            value="negate-filters"
            onClick={() => setNegateFilters(!filterParams.negateFilters)}
          >
            <LuCheck
              aria-hidden="true"
              visibility={filterParams.negateFilters ? "visible" : "hidden"}
            />{" "}
            Negate filters
          </Menu.Item>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}
