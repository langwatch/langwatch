import {
  Box,
  Button,
  Flex,
  HStack,
  IconButton,
  Input,
  Separator,
  Text,
  VStack,
} from "@chakra-ui/react";
import { format } from "date-fns";
import { Check, Clock, Copy } from "lucide-react";
import type React from "react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Popover } from "../../../../components/ui/popover";
import { Tooltip } from "../../../../components/ui/tooltip";
import type { TimeRange } from "../../stores/filterStore";
import { useFilterStore } from "../../stores/filterStore";
import {
  getPresetById,
  matchPreset,
  PRESET_GROUPS,
  type TimeRangePreset,
} from "../../utils/timeRangePresets";

const COPY_FEEDBACK_MS = 2000;

export const TimeRangePicker: React.FC = () => {
  const timeRange = useFilterStore((s) => s.timeRange);
  const setTimeRange = useFilterStore((s) => s.setTimeRange);
  const [open, setOpen] = useState(false);

  const activePreset = useMemo(
    () =>
      timeRange.presetId
        ? (getPresetById(timeRange.presetId) ?? null)
        : matchPreset(timeRange),
    [timeRange],
  );

  const applyPreset = (preset: TimeRangePreset) => {
    const { from, to } = preset.compute();
    setTimeRange({ from, to, label: preset.label, presetId: preset.id });
    setOpen(false);
  };

  const applyAbsolute = (range: { from: number; to: number }) => {
    setTimeRange(range);
    setOpen(false);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(e) => setOpen(e.open)}
      positioning={{ placement: "bottom-end" }}
    >
      <Popover.Trigger asChild>
        <Button size="xs" variant="outline" fontWeight="normal">
          <Clock size={12} />
          {formatTriggerLabel(timeRange)}
        </Button>
      </Popover.Trigger>
      <Popover.Content width="auto" minWidth="420px">
        <Popover.Body padding={0}>
          <Flex>
            <PresetColumn
              activePresetId={activePreset?.id ?? null}
              onSelect={applyPreset}
            />
            <AbsoluteRangeColumn range={timeRange} onApply={applyAbsolute} />
          </Flex>
          <Separator />
          <Footer range={timeRange} />
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
};

const PresetColumn: React.FC<{
  activePresetId: string | null;
  onSelect: (preset: TimeRangePreset) => void;
}> = ({ activePresetId, onSelect }) => (
  <VStack
    align="stretch"
    gap={0}
    paddingY={2}
    paddingX={1}
    minWidth="150px"
    borderRightWidth="1px"
    borderColor="border"
  >
    {PRESET_GROUPS.map((group, groupIdx) => (
      <Fragment key={group.label}>
        <Text
          textStyle="xs"
          fontWeight="medium"
          color="fg.subtle"
          paddingX={2}
          paddingBottom={1}
          paddingTop={groupIdx === 0 ? 0 : 2}
        >
          {group.label}
        </Text>
        {group.presets.map((preset) => (
          <PresetButton
            key={preset.id}
            preset={preset}
            isActive={activePresetId === preset.id}
            onClick={() => onSelect(preset)}
          />
        ))}
      </Fragment>
    ))}
  </VStack>
);

const PresetButton: React.FC<{
  preset: TimeRangePreset;
  isActive: boolean;
  onClick: () => void;
}> = ({ preset, isActive, onClick }) => (
  <Button
    variant="ghost"
    size="xs"
    justifyContent="flex-start"
    fontWeight={isActive ? "semibold" : "normal"}
    color={isActive ? "fg" : "fg.muted"}
    onClick={onClick}
  >
    <Flex width="14px" justify="center" align="center" flexShrink={0}>
      {isActive && <Check size={12} />}
    </Flex>
    {preset.label}
  </Button>
);

const AbsoluteRangeColumn: React.FC<{
  range: TimeRange;
  onApply: (range: { from: number; to: number }) => void;
}> = ({ range, onApply }) => {
  const [from, setFrom] = useState(() => toDatetimeLocal(range.from));
  const [to, setTo] = useState(() => toDatetimeLocal(range.to));

  useEffect(() => {
    setFrom(toDatetimeLocal(range.from));
    setTo(toDatetimeLocal(range.to));
  }, [range.from, range.to]);

  const parsed = parseAbsoluteRange({ from, to });

  return (
    <VStack align="stretch" gap={3} padding={3} flex={1}>
      <Text textStyle="xs" fontWeight="medium" color="fg.subtle">
        Absolute range
      </Text>
      <VStack align="stretch" gap={2}>
        <DatetimeField label="From" value={from} onChange={setFrom} />
        <DatetimeField label="To" value={to} onChange={setTo} />
      </VStack>
      <Button
        size="xs"
        colorPalette="blue"
        disabled={!parsed}
        onClick={() => parsed && onApply(parsed)}
      >
        Apply
      </Button>
    </VStack>
  );
};

const DatetimeField: React.FC<{
  label: string;
  value: string;
  onChange: (next: string) => void;
}> = ({ label, value, onChange }) => (
  <Box>
    <Text textStyle="xs" color="fg.muted" marginBottom={1}>
      {label}
    </Text>
    <Input
      size="xs"
      type="datetime-local"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </Box>
);

const Footer: React.FC<{ range: TimeRange }> = ({ range }) => {
  const [copied, setCopied] = useState(false);
  const timezone = useMemo(() => formatTimezone(), []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = () => {
    void navigator.clipboard.writeText(formatCopyText(range));
    setCopied(true);
  };

  return (
    <HStack justify="space-between" paddingX={3} paddingY={2}>
      <Text textStyle="xs" color="fg.subtle">
        {timezone}
      </Text>
      <Tooltip content={copied ? "Copied!" : "Copy time range"}>
        <IconButton
          aria-label="Copy time range"
          variant="ghost"
          size="xs"
          onClick={handleCopy}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </IconButton>
      </Tooltip>
    </HStack>
  );
};

function formatTriggerLabel(range: TimeRange): string {
  const preset = range.presetId
    ? getPresetById(range.presetId)
    : matchPreset(range);
  if (preset) return preset.shortLabel;
  const from = new Date(range.from);
  const to = new Date(range.to);
  return `${format(from, "MMM d, HH:mm")} - ${format(to, "MMM d, HH:mm")}`;
}

function toDatetimeLocal(epochMs: number): string {
  return format(new Date(epochMs), "yyyy-MM-dd'T'HH:mm");
}

function parseAbsoluteRange({
  from,
  to,
}: {
  from: string;
  to: string;
}): { from: number; to: number } | null {
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs >= toMs) return null;
  return { from: fromMs, to: toMs };
}

function formatTimezone(): string {
  const offset = new Date().getTimezoneOffset();
  const sign = offset <= 0 ? "+" : "-";
  const absMinutes = Math.abs(offset);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Local";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${tz} (UTC${sign}${pad(hours)}:${pad(minutes)})`;
}

function formatCopyText(range: TimeRange): string {
  const from = format(new Date(range.from), "yyyy-MM-dd HH:mm");
  const to = format(new Date(range.to), "yyyy-MM-dd HH:mm");
  return `${from} to ${to}`;
}
