import { clockOf, dateTimeOf, msOf } from "./clock.ts";

const UNITS = ["KB", "MB", "GB", "TB"];

/** Binary units, one decimal: "1.2 GB". Zero reads as a dash, not "0 B". */
export const formatBytes = ({ bytes }: { bytes: number }) => {
  if (bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${UNITS[unit] ?? "TB"}`;
};

export const formatDuration = ({ seconds }: { seconds: number }) => {
  if (seconds <= 0) return "—";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
};

/** "12s ago", "4m ago", "3h ago", "2d ago"; a missing time is "now", as the hub had it. */
export const formatAge = ({ at, now }: { at: string | null; now: number }) => {
  if (at === null) return "now";
  const seconds = Math.max(0, Math.round((now - msOf({ iso: at })) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
};

const msFrom = ({ at }: { at: string | number }) =>
  typeof at === "number" ? at : msOf({ iso: at });

/** The wall-clock time of an ISO string or epoch milliseconds: "14:02:09". */
export const formatClock = ({ at }: { at: string | number }) => clockOf({ ms: msFrom({ at }) });

export const formatDateTime = ({ at }: { at: string | number }) =>
  dateTimeOf({ ms: msFrom({ at }) });

export const formatCount = ({ count }: { count: number }) =>
  new Intl.NumberFormat("en-GB").format(count);

/** The last two segments of a path, the rest elided; the full path goes in a title. */
export const shortPath = ({ path }: { path: string }) => {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts.length <= 3 ? path : `…/${parts.slice(-2).join("/")}`;
};
