import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from "react";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogLine = { id?: string; text: string; level?: LogLevel; time?: string };

export type LogViewProps = {
  lines: LogLine[];
  /** Names the region for screen readers. */
  label?: string;
  /** 240/400/640px, or `fill` to take the parent's height. */
  height?: "sm" | "md" | "lg" | "fill";
  /** Start pinned to the newest line. Scrolling up pauses; "Jump to latest" resumes. */
  follow?: boolean;
  empty?: ReactNode;
  /** Marks every case-insensitive match of this text, e.g. a filter's query. */
  highlight?: string;
};

/** Past this many lines the view renders only what is on screen, one unwrapped row each. */
export const LOG_VIRTUALISE_ABOVE = 2000;
const ROW_HEIGHT = 20;
const OVERSCAN = 30;
const TAIL_SLACK = 24;

type Viewport = { top: number; height: number };

const distanceFromBottom = ({ element }: { element: HTMLElement }) =>
  element.scrollHeight - element.scrollTop - element.clientHeight;

const escapeRegExp = ({ text }: { text: string }) => text.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&");

/** Splits on a capturing pattern, so odd parts are the matches. */
const matcherFor = ({ highlight }: { highlight?: string }) =>
  highlight === undefined || highlight === ""
    ? undefined
    : new RegExp(`(${escapeRegExp({ text: highlight })})`, "giu");

const Marked = ({ text, matcher }: { text: string; matcher?: RegExp }) => {
  if (matcher === undefined) return text;
  return text.split(matcher).map((part, index) =>
    index % 2 === 1 ? (
      <mark key={index} className="ds-log-mark">
        {part}
      </mark>
    ) : (
      part
    ),
  );
};

const Line = ({ line, top, matcher }: { line: LogLine; top?: number; matcher?: RegExp }) => (
  <div
    className="ds-log-line"
    data-level={line.level ?? "info"}
    style={top === undefined ? undefined : { top }}
  >
    {line.time !== undefined && <span className="ds-log-time">{line.time}</span>}
    <span className="ds-log-text" title={top === undefined ? undefined : line.text}>
      <Marked text={line.text} matcher={matcher} />
    </span>
  </div>
);

const WindowedLines = ({
  lines,
  viewport,
  matcher,
}: {
  lines: LogLine[];
  viewport: Viewport;
  matcher?: RegExp;
}) => {
  const first = Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(
    lines.length,
    Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + OVERSCAN,
  );
  return (
    <div className="ds-log-window" style={{ height: lines.length * ROW_HEIGHT }}>
      {lines.slice(first, last).map((line, offset) => (
        <Line
          key={line.id ?? first + offset}
          line={line}
          top={(first + offset) * ROW_HEIGHT}
          matcher={matcher}
        />
      ))}
    </div>
  );
};

export const LogView = ({
  lines,
  label = "Log",
  height = "md",
  follow = true,
  empty = "No output yet.",
  highlight,
}: LogViewProps) => {
  const matcher = useMemo(() => matcherFor({ highlight }), [highlight]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(follow);
  const [viewport, setViewport] = useState<Viewport>({ top: 0, height: 640 });
  const windowed = lines.length > LOG_VIRTUALISE_ABOVE;

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (following) element.scrollTop = element.scrollHeight;
    if (windowed) setViewport({ top: element.scrollTop, height: element.clientHeight || 640 });
  }, [lines, following, windowed]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    setFollowing(distanceFromBottom({ element }) <= TAIL_SLACK);
    if (windowed) setViewport({ top: element.scrollTop, height: element.clientHeight });
  };

  return (
    <div className="ds-logview" data-height={height}>
      <div
        ref={scrollRef}
        className="ds-logview-scroll"
        role="log"
        aria-live="off"
        aria-label={label}
        onScroll={onScroll}
      >
        {lines.length === 0 && <div className="ds-logview-empty">{empty}</div>}
        {windowed ? (
          <WindowedLines lines={lines} viewport={viewport} matcher={matcher} />
        ) : (
          lines.map((line, index) => <Line key={line.id ?? index} line={line} matcher={matcher} />)
        )}
      </div>
      {!following && lines.length > 0 && (
        <button
          type="button"
          className="ds-button ds-logview-jump"
          data-size="sm"
          onClick={() => setFollowing(true)}
        >
          Jump to latest
        </button>
      )}
    </div>
  );
};
