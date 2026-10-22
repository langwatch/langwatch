import { Text } from "@langwatch/design-system/primitives";
import { Temporal } from "@langwatch/time";

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function parseInstant({ date }: { date: string }) {
  try {
    return Temporal.Instant.from(date);
  } catch {
    return null;
  }
}

/** The page's last commit date; nothing when the build could not date it. */
export function LastUpdated({ date }: { date: string }) {
  const instant = parseInstant({ date });
  if (!instant) return null;
  return (
    <Text
      className="docs-last-updated"
      margin="0"
      fontSize="13px"
      lineHeight="20px"
      color="fg.muted"
    >
      Last updated{" "}
      <time dateTime={instant.toString({ fractionalSecondDigits: 3 })}>
        {DATE.format(instant.epochMilliseconds)}
      </time>
    </Text>
  );
}
