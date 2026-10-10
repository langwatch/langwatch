/** Asks how much of the audit trail an export takes before it walks the batches. */

import { Dialog } from "@langwatch/design-system/dialog";
import { Button, HStack, Input, Text, VStack } from "@langwatch/design-system/primitives";
import { Radio, RadioGroup } from "@langwatch/design-system/radio";
import type { Instant } from "@langwatch/time";
import { useState } from "react";

import {
  AUDIT_EXPORT_RANGES,
  auditExportWindows,
  type AuditExportRangeKey,
  type AuditExportWindow,
} from "../../model/audit-export-range.ts";
import type { AuditPeriod } from "../../model/audit-period.ts";

function isRangeKey(value: string | null): value is AuditExportRangeKey {
  return AUDIT_EXPORT_RANGES.some((range) => range.key === value);
}

export function AuditExportDialog({
  open,
  view,
  now,
  appliedFilters,
  isExporting,
  onClose,
  onExport,
}: {
  open: boolean;
  view: AuditPeriod;
  now: Instant;
  /** "user Alice, action gateway., project Web App", or empty when none apply. */
  appliedFilters: string;
  isExporting: boolean;
  onClose: () => void;
  onExport: (span: AuditExportWindow) => void;
}) {
  const [range, setRange] = useState<AuditExportRangeKey>("view");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [chosen] = auditExportWindows({ range, view, now, custom });

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(details) => {
        if (!details.open) onClose();
      }}
      placement="center"
    >
      <Dialog.Content maxWidth="440px">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title>Export audit log</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={4}>
            <RadioGroup
              size="sm"
              value={range}
              aria-label="How much to export"
              onValueChange={({ value }: { value: string | null }) => {
                if (isRangeKey(value)) setRange(value);
              }}
            >
              <VStack align="start" gap={2}>
                {AUDIT_EXPORT_RANGES.map((option) => (
                  <Radio key={option.key} value={option.key}>
                    {option.label}
                  </Radio>
                ))}
              </VStack>
            </RadioGroup>
            {range === "custom" && (
              <HStack gap={2}>
                <Input
                  type="date"
                  size="sm"
                  aria-label="From"
                  value={custom.from}
                  onChange={(event) => setCustom({ ...custom, from: event.target.value })}
                />
                <Text color="fg.muted" fontSize="sm">
                  to
                </Text>
                <Input
                  type="date"
                  size="sm"
                  aria-label="To"
                  value={custom.to}
                  onChange={(event) => setCustom({ ...custom, to: event.target.value })}
                />
              </HStack>
            )}
            <Text color="fg.muted" fontSize="sm">
              {appliedFilters
                ? `The user, action and project filters apply to every option: ${appliedFilters}.`
                : "No user, action or project filter is applied."}
            </Text>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            size="sm"
            disabled={!chosen || isExporting}
            loading={isExporting}
            onClick={() => {
              if (chosen) onExport(chosen);
            }}
          >
            Export
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
