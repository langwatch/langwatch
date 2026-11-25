import { nowInstant } from "@langwatch/time";
import { z } from "zod";

/** How many console messages and requests the buffer keeps, newest last. */
export const PAGE_BUFFER_LIMIT = 200;
const TEXT_LIMIT = 500;
const LEVELS = ["error", "warn", "info", "log", "debug"] as const;

export const consoleEntrySchema = z.object({
  level: z.enum(LEVELS),
  text: z.string(),
  at: z.string(),
});
export type ConsoleEntry = z.infer<typeof consoleEntrySchema>;

/** One request: never its body, headers or query string, any of which can carry a credential. */
export const networkEntrySchema = z.object({
  method: z.string(),
  url: z.string(),
  status: z.number(),
  durationMs: z.number(),
  failed: z.boolean(),
  at: z.string(),
});
export type NetworkEntry = z.infer<typeof networkEntrySchema>;

export type PageBuffer = {
  console: ConsoleEntry[];
  network: NetworkEntry[];
  /** Calls `listener` after each new entry. */
  subscribe: (params: { listener: () => void }) => void;
  /** Puts console, fetch and XHR back as they were. */
  detach: () => void;
};

type Host = Window & typeof globalThis;
type Level = (typeof LEVELS)[number];
type RecordRequest = (entry: Omit<NetworkEntry, "at">) => void;

/** A request's address without its query or fragment, either of which can carry a token. */
export const safeUrl = ({ url, base }: { url: string; base: string }): string => {
  try {
    const parsed = new URL(url, base);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "(unparsable url)";
  }
};

const describe = (value: unknown): string => {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value !== "object" || value === null) return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "[object]";
  }
};

const addressOf = (value: unknown): string => {
  if (value instanceof URL) return value.href;
  return typeof value === "string" ? value : "";
};

const isFailure = (status: number) => status === 0 || status >= 400;
const elapsed = (started: number) => Math.round(performance.now() - started);

const keepNewest = <T>({ list, entry }: { list: T[]; entry: T }) => {
  list.push(entry);
  if (list.length > PAGE_BUFFER_LIMIT) list.splice(0, list.length - PAGE_BUFFER_LIMIT);
};

const wrapConsole = ({
  host,
  level,
  record,
}: {
  host: Host;
  level: Level;
  record: (entry: Omit<ConsoleEntry, "at">) => void;
}) => {
  const original = host.console[level].bind(host.console);
  host.console[level] = (...args: unknown[]) => {
    original(...args);
    record({
      level,
      text: args
        .map((arg) => describe(arg))
        .join(" ")
        .slice(0, TEXT_LIMIT),
    });
  };
  return () => {
    host.console[level] = original;
  };
};

const wrapFetch = ({ host, record }: { host: Host; record: RecordRequest }) => {
  const original = host.fetch;
  host.fetch = async (input, init) => {
    const started = performance.now();
    const request = input instanceof Request ? input : undefined;
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const url = safeUrl({ url: request?.url ?? addressOf(input), base: host.location.href });
    let status = 0;
    try {
      const response = await original.call(host, input, init);
      status = response.status;
      return response;
    } finally {
      record({ method, url, status, failed: isFailure(status), durationMs: elapsed(started) });
    }
  };
  return () => {
    host.fetch = original;
  };
};

/** Wraps `open` alone: it names the method and address, and `loadend` brings the status. */
const wrapXhr = ({ host, record }: { host: Host; record: RecordRequest }) => {
  const proto = host.XMLHttpRequest.prototype;
  const original: unknown = Reflect.get(proto, "open");
  if (typeof original !== "function") return () => undefined;
  proto.open = function open(this: XMLHttpRequest, ...args: unknown[]) {
    const started = performance.now();
    const method = typeof args[0] === "string" ? args[0].toUpperCase() : "GET";
    const url = safeUrl({ url: addressOf(args[1]), base: host.location.href });
    const done = () =>
      record({
        method,
        url,
        status: this.status,
        failed: isFailure(this.status),
        durationMs: elapsed(started),
      });
    this.addEventListener("loadend", done, { once: true });
    Reflect.apply(original, this, args);
  };
  return () => {
    Reflect.set(proto, "open", original);
  };
};

/** Starts keeping the page's console messages and requests; what the page sees is unchanged. */
export function attachPageBuffer({ host }: { host: Host }): PageBuffer {
  const consoleEntries: ConsoleEntry[] = [];
  const networkEntries: NetworkEntry[] = [];
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const at = () => nowInstant().toString();
  const recordConsole = (entry: Omit<ConsoleEntry, "at">) => {
    keepNewest({ list: consoleEntries, entry: { ...entry, at: at() } });
    notify();
  };
  const recordRequest: RecordRequest = (entry) => {
    keepNewest({ list: networkEntries, entry: { ...entry, at: at() } });
    notify();
  };
  const restores = [
    ...LEVELS.map((level) => wrapConsole({ host, level, record: recordConsole })),
    wrapFetch({ host, record: recordRequest }),
    wrapXhr({ host, record: recordRequest }),
  ];
  return {
    console: consoleEntries,
    network: networkEntries,
    subscribe: ({ listener }) => {
      listeners.add(listener);
    },
    detach: () => {
      restores.forEach((restore) => restore());
      listeners.clear();
    },
  };
}
