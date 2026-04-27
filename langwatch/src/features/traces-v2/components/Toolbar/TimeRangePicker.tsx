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
import { Fragment, useCallback, useMemo, useState } from "react";
import { Popover } from "../../../../components/ui/popover";
import { Tooltip } from "../../../../components/ui/tooltip";
import { useFilterStore } from "../../stores/filterStore";
import type { TimeRange } from "../../stores/filterStore";
import {
  ALL_PRESETS,
  PRESET_GROUPS,
  getPresetById,
  matchPreset,
  type TimeRangePreset,
} from "../../utils/timeRangePresets";

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

function fromDatetimeLocal(value: string): number {
  return new Date(value).getTime();
}

function formatTimezone(): string {
  const offset = new Date().getTimezoneOffset();
  const sign = offset <= 0 ? "+" : "-";
  const absMinutes = Math.abs(offset);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  const tz =
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Local";
  return `${tz} (UTC${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")})`;
}

function formatCopyText(range: TimeRange): string {
  const from = new Date(range.from);
  const to = new Date(range.to);
  return `${format(from, "yyyy-MM-dd HH:mm")} to ${format(to, "yyyy-MM-dd HH:mm")}`;
}

export const TimeRangePicker: React.FC = () => {
  const timeRange = useFilterStore((s) => s.timeRange);
  const setTimeRange = useFilterStore((s) => s.setTimeRange);

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const [localFrom, setLocalFrom] = useState(() =>
    toDatetimeLocal(timeRange.from),
  );
  const [localTo, setLocalTo] = useState(() =>
    toDatetimeLocal(timeRange.to),
  );

  const activePreset = useMemo(() => {
    if (timeRange.presetId) return getPresetById(timeRange.presetId) ?? null;
    return matchPreset(timeRange);
  }, [timeRange]);
  const timezone = useMemo(() => formatTimezone(), []);

  const handleOpenChange = useCallback(
    (details: { open: boolean }) => {
      setOpen(details.open);
      if (details.open) {
        setLocalFrom(toDatetimeLocal(timeRange.from));
        setLocalTo(toDatetimeLocal(timeRange.to));
        setCopied(false);
      }
    },
    [timeRange],
  );

  const applyPreset = useCallback(
    (preset: TimeRangePreset) => {
      const { from, to } = preset.compute();
      setTimeRange({ from, to, label: preset.label, presetId: preset.id });
      setOpen(false);
    },
    [setTimeRange],
  );

  const applyAbsolute = useCallback(() => {
    const from = fromDatetimeLocal(localFrom);
    const to = fromDatetimeLocal(localTo);
    if (!Number.isNaN(from) && !Number.isNaN(to) && from < to) {
      setTimeRange({ from, to });
      setOpen(false);
    }
  }, [localFrom, localTo, setTimeRange]);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(formatCopyText(timeRange));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [timeRange]);

  const isAbsoluteValid = useMemo(() => {
    const from = fromDatetimeLocal(localFrom);
    const to = fromDatetimeLocal(localTo);
    return !Number.isNaN(from) && !Number.isNaN(to) && from < to;
  }, [localFrom, localTo]);

  return (
    <Popover.Root
      open={open}
      onOpenChange={handleOpenChange}
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
            {/* Left column: relative presets */}
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
                  {group.presets.map((preset) => {
                    const isActive = activePreset?.id === preset.id;
                    return (
                      <Button
                        key={preset.id}
                        variant="ghost"
                        size="xs"
                        justifyContent="flex-start"
                        fontWeight={isActive ? "semibold" : "normal"}
                        color={isActive ? "fg" : "fg.muted"}
                        onClick={() => applyPreset(preset)}
                      >
                        <Flex
                          width="14px"
                          justify="center"
                          align="center"
                          flexShrink={0}
                        >
                          {isActive && <Check size={12} />}
                        </Flex>
                        {preset.label}
                      </Button>
                    );
                  })}
                </Fragment>
              ))}
            </VStack>

            {/* Right column: absolute date/time */}
            <VStack
              align="stretch"
              gap={3}
              padding={3}
              flex={1}
            >
              <Text
                textStyle="xs"
                fontWeight="medium"
                color="fg.subtle"
              >
                Absolute range
              </Text>

              <VStack align="stretch" gap={2}>
                <Box>
                  <Text textStyle="xs" color="fg.muted" marginBottom={1}>
                    From
                  </Text>
                  <Input
                    size="xs"
                    type="datetime-local"
                    value={localFrom}
                    onChange={(e) => setLocalFrom(e.target.value)}
                  />
                </Box>
                <Box>
                  <Text textStyle="xs" color="fg.muted" marginBottom={1}>
                    To
                  </Text>
                  <Input
                    size="xs"
                    type="datetime-local"
                    value={localTo}
                    onChange={(e) => setLocalTo(e.target.value)}
                  />
                </Box>
              </VStack>

              <Button
                size="xs"
                colorPalette="blue"
                disabled={!isAbsoluteValid}
                onClick={applyAbsolute}
              >
                Apply
              </Button>
            </VStack>
          </Flex>

          {/* Footer: timezone + copy */}
          <Separator />
          <HStack
            justify="space-between"
            paddingX={3}
            paddingY={2}
          >
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
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
};
