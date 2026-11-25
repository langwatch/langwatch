import { nowInstant } from "@langwatch/time";
import { z } from "zod";

import { consoleEntrySchema, networkEntrySchema, type PageBuffer } from "./page-buffer";

const boxSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
export type Box = z.infer<typeof boxSchema>;

const targetSchema = z.object({
  selector: z.string(),
  tag: z.string(),
  role: z.string().optional(),
  text: z.string().optional(),
  box: boxSchema,
});
export type Target = z.infer<typeof targetSchema>;

export const pageSnapshotSchema = z.object({
  url: z.string(),
  at: z.string(),
  console: z.array(consoleEntrySchema),
  network: z.array(networkEntrySchema),
});
export type PageSnapshot = z.infer<typeof pageSnapshotSchema>;

/** One note as haven stores it (tools/thuishaven/adapters/orbstore, Report). */
export const feedbackSchema = z.object({
  ...pageSnapshotSchema.shape,
  note: z.string().min(1),
  route: z.string(),
  viewport: boxSchema,
  target: targetSchema.optional(),
  region: boxSchema.optional(),
  /** A PNG data URL of the element or region; haven stores it beside the note. */
  image: z.string().startsWith("data:image/png;base64,").optional(),
});
export type Feedback = z.infer<typeof feedbackSchema>;

/** What the reader pointed at: one element, or a rectangle of the viewport. */
export type Subject = { kind: "element"; element: Element } | { kind: "region"; box: Box };

export type OrbLocation = Pick<Location, "protocol" | "hostname" | "port">;

const STABLE_ID = /^[A-Za-z][\w-]*$/u;

const stepOf = ({ element }: { element: Element }): string => {
  const tag = element.tagName.toLowerCase();
  const twins = Array.from(element.parentElement?.children ?? []).filter(
    (sibling) => sibling.tagName === element.tagName,
  );
  return twins.length > 1 ? `${tag}:nth-of-type(${twins.indexOf(element) + 1})` : tag;
};

/** A selector that finds the element again: a test id, a stable id, else its nth-of-type path. */
export function selectorOf({ element }: { element: Element }): string {
  const steps: string[] = [];
  for (
    let current: Element | null = element;
    current?.parentElement;
    current = current.parentElement
  ) {
    const testId = current.getAttribute("data-testid");
    if (testId) return [`[data-testid="${testId.replaceAll('"', '\\"')}"]`, ...steps].join(" > ");
    if (STABLE_ID.test(current.id)) return [`#${current.id}`, ...steps].join(" > ");
    steps.unshift(stepOf({ element: current }));
  }
  return steps.join(" > ");
}

/** The picked element: its selector, tag, role, a text snippet and its box. */
export function describeTarget({ element }: { element: Element }): Target {
  const { x, y, width, height } = element.getBoundingClientRect();
  const role = element.getAttribute("role");
  const text = (element.textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 120);
  return {
    selector: selectorOf({ element }),
    tag: element.tagName.toLowerCase(),
    box: { x, y, width, height },
    ...(role ? { role } : {}),
    ...(text ? { text } : {}),
  };
}

/** The buffer as it stands, for a push to haven or a note. */
export function snapshotPage({ buffer, href }: { buffer: PageBuffer; href: string }): PageSnapshot {
  return {
    url: href,
    at: nowInstant().toString(),
    console: [...buffer.console],
    network: [...buffer.network],
  };
}

/** The reader's note on what they pointed at, with the page's recent console and requests. */
export function buildFeedback({
  note,
  subject,
  buffer,
  host,
  image,
}: {
  note: string;
  subject: Subject;
  buffer: PageBuffer;
  host: Window;
  image?: string;
}): Feedback {
  const page = snapshotPage({ buffer, href: host.location.href });
  const viewport = { x: 0, y: 0, width: host.innerWidth, height: host.innerHeight };
  const pointedAt =
    subject.kind === "element"
      ? { target: describeTarget({ element: subject.element }) }
      : { region: subject.box };
  const shot = image ? { image } : {};
  return { ...page, note, route: host.location.pathname, viewport, ...pointedAt, ...shot };
}

/** The stack home's orb routes: the app host (`app.<slug>.<domain>`) minus its first label. */
export function havenEndpoint({ location }: { location: OrbLocation }): {
  slug: string;
  base: string;
} {
  const [, slug = "", ...domain] = location.hostname.split(".");
  const port = location.port ? `:${location.port}` : "";
  const home = `${location.protocol}//${[slug, ...domain].join(".")}${port}`;
  return { slug, base: `${home}/api/stacks/${slug}/orb` };
}

/** Posts JSON to haven with `send`, the fetch the page buffer does not record. */
export async function postToHaven({
  send,
  url,
  body,
}: {
  send: typeof fetch;
  url: string;
  body: unknown;
}): Promise<boolean> {
  try {
    const response = await send(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch {
    return false;
  }
}
