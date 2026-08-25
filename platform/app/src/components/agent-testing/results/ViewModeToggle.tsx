/**
 * Table or the classic grid of live cards. The choice is written to the
 * address, so a shared link opens the results the way they were shared.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { HStack, IconButton } from "@chakra-ui/react";
import { LayoutGrid, Table2 } from "lucide-react";
import { Tooltip } from "~/components/ui/tooltip";
import { FG_FAINT } from "../shared/design";
import type { AgentTestingViewMode } from "../useAgentTestingStore";

export type ViewModeToggleProps = {
  viewMode: AgentTestingViewMode;
  onChange: (viewMode: AgentTestingViewMode) => void;
};

const MODES: {
  value: AgentTestingViewMode;
  label: string;
  icon: typeof Table2;
}[] = [
  { value: "table", label: "Table", icon: Table2 },
  { value: "grid", label: "Grid, watch the conversations", icon: LayoutGrid },
];

export function ViewModeToggle({ viewMode, onChange }: ViewModeToggleProps) {
  return (
    <HStack
      gap={0.5}
      padding={0.5}
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      data-testid="view-mode-toggle"
    >
      {MODES.map(({ value, label, icon: Icon }) => (
        <Tooltip key={value} content={label}>
          <IconButton
            size="xs"
            variant="ghost"
            minWidth="26px"
            height="26px"
            borderRadius="md"
            background={viewMode === value ? "bg.muted" : undefined}
            color={viewMode === value ? "fg" : FG_FAINT}
            aria-label={label}
            aria-pressed={viewMode === value}
            onClick={() => onChange(value)}
          >
            <Icon size={14} />
          </IconButton>
        </Tooltip>
      ))}
    </HStack>
  );
}
