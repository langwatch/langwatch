import { Text } from "@langwatch/design-system/primitives";

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** The page's last commit date; nothing when the build could not date it. */
export function LastUpdated({ date }: { date: string }) {
  const time = Date.parse(date);
  if (!date || Number.isNaN(time)) return null;
  return (
    <Text
      className="docs-last-updated"
      margin="0"
      fontSize="13px"
      lineHeight="20px"
      color="fg.muted"
    >
      Last updated <time dateTime={new Date(time).toISOString()}>{DATE.format(time)}</time>
    </Text>
  );
}
