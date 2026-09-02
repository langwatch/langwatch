/**
 * The window picker above the audit table.
 *
 * The presentation half of `model/audit-period.ts`, and narrowed the same way:
 * the platform control also offers two `datetime-local` inputs and an "All
 * time" entry, neither of which the audit page ever showed. Presets only, which
 * is what its URL has always carried.
 */

import { Box, Button, Text, VStack } from "@chakra-ui/react";
import { Popover } from "@langwatch/design-system/popover";
import { Calendar, ChevronDown } from "lucide-react";
import { useState } from "react";
import { AUDIT_PERIOD_PRESETS, type AuditPeriodPresetKey } from "../../model/audit-period";

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
