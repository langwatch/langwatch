/** Asks how much of the audit trail an export takes before it walks the batches. */

import { Dialog } from "@langwatch/design-system/dialog";
import { Field, HStack, Input, Text, VStack } from "@langwatch/design-system/primitives";
import { Radio, RadioGroup } from "@langwatch/design-system/radio";
import type { Instant } from "@langwatch/time";
import { type FormEvent, useRef, useState } from "react";

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

function customRangeProblems({
  custom,
  enabled,
  chosen,
}: {
  custom: { from: string; to: string };
  enabled: boolean;
  chosen: AuditExportWindow | undefined;
}): { fromError: string | undefined; toError: string | undefined } {
  if (!enabled) return { fromError: void 0, toError: void 0 };
  if (!custom.from) {
    return {
      fromError: "Choose the first day to export.",
      toError: custom.to ? void 0 : "Choose the last day to export.",
    };
  }
  if (!custom.to) return { fromError: void 0, toError: "Choose the last day to export." };
  return {
    fromError: void 0,
    toError: chosen ? void 0 : "The last day must not be before the first day.",
  };
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
  const [attempted, setAttempted] = useState(false);
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  const customRange = range === "custom";
  const { fromError, toError } = customRangeProblems({ custom, enabled: customRange, chosen });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isExporting) return;
    setAttempted(true);
    if (fromError) fromRef.current?.focus();
    else if (toError) toRef.current?.focus();
    else if (chosen) onExport(chosen);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Export audit log"
      size="sm"
      placement="center"
      onSubmit={submit}
      primaryAction={{
        label: "Export",
        type: "submit",
        loading: isExporting,
      }}
    >
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
        {customRange && (
          <HStack gap={2} align="start">
            <Field.Root invalid={attempted && fromError !== void 0}>
              <Input
                ref={fromRef}
                type="date"
                size="sm"
                aria-label="From"
                value={custom.from}
                onChange={(event) => setCustom({ ...custom, from: event.target.value })}
              />
              <Field.ErrorText>{fromError}</Field.ErrorText>
            </Field.Root>
            <Text color="fg.muted" fontSize="sm" paddingTop={1.5}>
              to
            </Text>
            <Field.Root invalid={attempted && toError !== void 0}>
              <Input
                ref={toRef}
                type="date"
                size="sm"
                aria-label="To"
                value={custom.to}
                onChange={(event) => setCustom({ ...custom, to: event.target.value })}
              />
              <Field.ErrorText>{toError}</Field.ErrorText>
            </Field.Root>
          </HStack>
        )}
        <Text color="fg.muted" fontSize="sm">
          {appliedFilters
            ? `The user, action and project filters apply to every option: ${appliedFilters}.`
            : "No user, action or project filter is applied."}
        </Text>
      </VStack>
    </Dialog>
  );
}
