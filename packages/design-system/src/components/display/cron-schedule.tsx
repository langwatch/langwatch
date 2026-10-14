/**
 * A cron schedule said as a sentence ("Every Monday at 09:00"), its timezone as
 * a quiet suffix, and the expression as a monospace chip whose five fields each
 * name themselves on hover. Shapes it cannot say read "Custom schedule".
 */
import { Box, HStack, Text, VStack } from "@chakra-ui/react";

import { Tooltip } from "../overlays/tooltip.tsx";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

interface CronField {
  label: string;
  unit: string;
  name: (n: number) => string;
}

const FIELDS: CronField[] = [
  { label: "Minute", unit: "minute", name: (n) => `minute ${n}` },
  { label: "Hour", unit: "hour", name: (n) => `${pad(n)}:00` },
  { label: "Day of month", unit: "day", name: (n) => `the ${ordinal(n)}` },
  { label: "Month", unit: "month", name: (n) => MONTHS[n - 1] ?? String(n) },
  { label: "Day of week", unit: "day", name: (n) => WEEKDAYS[n % 7] ?? String(n) },
];

const pad = (n: number) => String(n).padStart(2, "0");
const isNumber = (field: string) => /^\d+$/.test(field);
const stepOf = (field: string) => /^\*\/(\d+)$/.exec(field)?.[1];

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

function joinNames(names: string[]): string {
  return names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function every(n: number, unit: string): string {
  return n === 1 ? `every ${unit}` : `every ${n} ${unit}s`;
}

/** What one field of an expression means, e.g. "every 15 minutes" or "Monday to Friday". */
export function describeCronField({ index, value }: { index: number; value: string }): string {
  const field = FIELDS[index];
  if (!field) return value;
  if (value === "*") return `every ${field.unit}`;
  const step = stepOf(value);
  if (step) return every(Number(step), field.unit);
  const items = value.split(",").map((item) => {
    const range = /^(\d+)-(\d+)$/.exec(item);
    if (range) return `${field.name(Number(range[1]))} to ${field.name(Number(range[2]))}`;
    return isNumber(item) ? field.name(Number(item)) : item;
  });
  return joinNames(items);
}

function describeDays({ dom, dow }: { dom: string; dow: string }): string | null {
  if (dom === "*" && dow === "*") return "Every day";
  if (dom === "*" && dow === "1-5") return "Weekdays";
  if (dom === "*" && (dow === "0,6" || dow === "6,0")) return "Weekends";
  if (dom === "*" && dow.split(",").every(isNumber)) {
    return `Every ${joinNames(dow.split(",").map((d) => WEEKDAYS[Number(d) % 7] ?? d))}`;
  }
  if (dom === "*" && /^\d-\d$/.test(dow)) return describeCronField({ index: 4, value: dow });
  if (dow === "*" && isNumber(dom)) return `On the ${ordinal(Number(dom))} of every month`;
  return null;
}

/** The schedule as a sentence, or null for shapes it does not say. */
export function describeCronSchedule(cron: string): string | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute = "", hour = "", dom = "", month = "", dow = ""] = fields;
  if (month !== "*") return null;
  const everyDay = dom === "*" && dow === "*";
  const minuteStep = minute === "*" ? "1" : stepOf(minute);
  if (minuteStep && hour === "*" && everyDay)
    return capitalise(every(Number(minuteStep), "minute"));
  if (!isNumber(minute)) return null;
  const past = Number(minute) === 0 ? "" : ` at :${pad(Number(minute))}`;
  if (hour === "*" && everyDay) return `Every hour${past}`;
  const hourStep = stepOf(hour);
  if (hourStep && everyDay) return `${capitalise(every(Number(hourStep), "hour"))}${past}`;
  if (!isNumber(hour)) return null;
  const days = describeDays({ dom, dow });
  return days ? `${days} at ${pad(Number(hour))}:${pad(Number(minute))}` : null;
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "Europe/Amsterdam" reads "Amsterdam"; the full zone stays in the tooltip. */
function shortZone(timezone: string): string {
  return (timezone.split("/").at(-1) ?? timezone).replaceAll("_", " ");
}

export interface CronScheduleProps {
  cron: string;
  /** IANA zone; empty means UTC, as the scheduler reads it. */
  timezone?: string;
}

export function CronSchedule({ cron, timezone }: CronScheduleProps) {
  const zone = timezone?.trim() || "UTC";
  const sentence = describeCronSchedule(cron) ?? "Custom schedule";
  const fields = cron.trim().split(/\s+/);

  return (
    <VStack align="start" gap="1" minWidth={0} maxWidth="full">
      <Tooltip content={`${sentence} (${zone})`} positioning={{ placement: "top" }}>
        <HStack gap="1.5" minWidth={0} maxWidth="full" whiteSpace="nowrap">
          <Text textStyle="sm" fontWeight="medium" truncate>
            {sentence}
          </Text>
          <Text textStyle="xs" color="fg.muted" flexShrink={0}>
            {shortZone(zone)}
          </Text>
        </HStack>
      </Tooltip>
      <Box
        as="code"
        aria-label={`Cron expression ${cron.trim()}`}
        display="inline-flex"
        gap="1"
        paddingX="1.5"
        paddingY="0.5"
        borderRadius="sm"
        borderWidth="1px"
        borderColor="border.muted"
        bg="bg.subtle"
        fontFamily="mono"
        textStyle="xs"
        color="fg.muted"
        whiteSpace="nowrap"
        maxWidth="full"
        overflow="hidden"
      >
        {fields.map((value, index) => (
          <Tooltip
            key={FIELDS[index]?.label ?? `${index}`}
            content={
              FIELDS[index]
                ? `${FIELDS[index].label}: ${describeCronField({ index, value })}`
                : value
            }
            positioning={{ placement: "top" }}
          >
            <Box as="span" data-cron-field={FIELDS[index]?.label} _hover={{ color: "fg" }}>
              {value}
            </Box>
          </Tooltip>
        ))}
      </Box>
    </VStack>
  );
}
