import { Callout, CodeBlock, EmptyState } from "@langwatch/design-system-internal";
import { formatDistanceToNow, Temporal, toDate, toEpochMs, type TimeInput } from "@langwatch/time";

export const SimEmpty = ({ title, hint }: { title: string; hint?: string }) => (
  <EmptyState title={title} description={hint} />
);

/** What the simulator refused, in its own words. */
export const SimRefusal = ({ message }: { message: string }) => (
  <Callout tone="error">{message}</Callout>
);

export const SimCode = ({ text, language }: { text: string; language?: string }) => (
  <div className="sim-code" data-language={language}>
    <CodeBlock code={text} label={language} wrap />
  </div>
);

/** A value as indented JSON: folds away (open unless `open` is false), and the block copies. */
export const SimJson = ({
  value,
  label = "JSON",
  open = true,
}: {
  value: unknown;
  label?: string;
  open?: boolean;
}) => (
  <details className="sim-json" open={open}>
    <summary>{label}</summary>
    <CodeBlock code={JSON.stringify(value, null, 2)} label="JSON" wrap />
  </details>
);

const absolute = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });

/** "3 minutes ago", with the absolute time on hover. */
export const SimTime = ({ at }: { at: TimeInput }) => {
  const ms = toEpochMs(at);
  if (Number.isNaN(ms)) return <time>{String(at)}</time>;
  const instant = Temporal.Instant.fromEpochMilliseconds(ms);
  return (
    <time dateTime={instant.toString()} title={absolute.format(toDate(instant))}>
      {formatDistanceToNow(at, { addSuffix: true })}
    </time>
  );
};

/** The time from `from` to `to` in seconds, as "12.3 s"; "live" while `to` is absent. */
export const SimDuration = ({ from, to }: { from: TimeInput; to?: TimeInput }) => {
  if (to === undefined) return <>live</>;
  const seconds = (toEpochMs(to) - toEpochMs(from)) / 1_000;
  return <>{Number.isNaN(seconds) ? "unknown" : `${seconds.toFixed(1)} s`}</>;
};
