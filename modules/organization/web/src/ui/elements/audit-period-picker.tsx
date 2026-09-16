/**
 * The window picker above the audit table — the presentation half of
 * `model/audit-period.ts`, narrowed the same way: no `datetime-local`
 * inputs or "All time" entry, presets only, matching what its URL carries.
 */

import { Box, Button, Text, VStack } from "@chakra-ui/react";
import { Popover } from "@langwatch/design-system/popover";
import { Calendar, ChevronDown } from "lucide-react";
import { useState } from "react";
import { AUDIT_PERIOD_PRESETS, type AuditPeriodPresetKey } from "../../model/audit-period.ts";

export function AuditPeriodPicker({
  label,
  onPick,
}: {
  label: string;
  onPick: (presetKey: AuditPeriodPresetKey) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root
      open={open}
      onOpenChange={(details) => setOpen(details.open)}
      positioning={{ placement: "bottom-end" }}
      size="sm"
    >
      <Popover.Trigger asChild>
        <Button variant="outline" size="sm" minWidth="fit-content">
          <Calendar size={16} />
          <Text>{label}</Text>
          <Box>
            <ChevronDown size={16} />
          </Box>
        </Button>
      </Popover.Trigger>
      <Popover.Content width="fit-content">
        <Popover.Arrow />
        <Popover.CloseTrigger />
        <Popover.Header>
          <Popover.Title>Select Date Range</Popover.Title>
        </Popover.Header>
        <Popover.Body>
          <VStack>
            {AUDIT_PERIOD_PRESETS.map((preset) => (
              <Button
                width="full"
                key={preset.key}
                onClick={() => {
                  onPick(preset.key);
                  setOpen(false);
                }}
              >
                {preset.label}
              </Button>
            ))}
          </VStack>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}
