/**
 * The pure half of `haven browser record|replay` (browser-daemon.ts drives it):
 * the script shape, the stable-locator description and the query comparison.
 * No browser import here, so node --test can run it (browser-record.test.ts).
 */
import type { Locator, Page } from "playwright";

export const REDACTED = "<redacted>";

/** What a replay can find again: Playwright's own locator vocabulary, never a snapshot ref. */
export type LocatorSpec = {
  by: "role" | "label" | "testid" | "placeholder" | "text" | "css";
  value: string;
  name?: string;
  nth?: number;
};

export type Query = { method: string; path: string; status: number };

export type Step = {
  verb: "goto" | "click" | "hover" | "drag" | "fill" | "select" | "type" | "press";
  url?: string;
  locator?: LocatorSpec;
  /** drag: the element dropped on, or the pixel offset when there is none. */
  target?: LocatorSpec;
  by?: { dx: number; dy: number };
  text?: string;
  key?: string;
  native?: boolean;
  expect: { url: string; queries: Query[] };
};

export type Script = { version: 1; startUrl?: string; steps: Step[] };

/** What the page says about an element; runs inside the browser, so it must be self-contained. */
export type Described = {
  tag: string;
  role: string;
  name: string;
  label: string;
  testid: string;
  placeholder: string;
  text: string;
  id: string;
  secret: boolean;
};

export function describeElement(el: Element): Described {
  const text = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const tag = el.tagName.toLowerCase();
  const input = el as HTMLInputElement;
  const type = tag === "input" ? input.type : "";
  const roles: Record<string, string> = {
    button: "button",
    a: "link",
    select: "combobox",
    textarea: "textbox",
    h1: "heading",
    h2: "heading",
    h3: "heading",
    h4: "heading",
  };
  const inputRoles: Record<string, string> = {
    checkbox: "checkbox",
    radio: "radio",
    button: "button",
    submit: "button",
    text: "textbox",
    email: "textbox",
    search: "textbox",
    password: "textbox",
    number: "spinbutton",
  };
  const role = el.getAttribute("role") ?? (tag === "input" ? inputRoles[type] : roles[tag]) ?? "";
  const labelled = text(
    el.getAttribute("aria-labelledby") &&
      el
        .getAttribute("aria-labelledby")!
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent)
        .join(" "),
  );
  const labels = (input as HTMLInputElement & { labels?: NodeListOf<HTMLLabelElement> }).labels;
  const label = text(labels?.[0]?.textContent) || labelled;
  const content = text((el as HTMLElement).innerText);
  const hint = `${input.name ?? ""} ${el.id} ${el.getAttribute("autocomplete") ?? ""}`;
  return {
    tag,
    role,
    name: text(el.getAttribute("aria-label")) || label || content || text(input.value),
    label,
    testid: el.getAttribute("data-testid") ?? "",
    placeholder: el.getAttribute("placeholder") ?? "",
    text: content,
    id: el.id,
    secret: type === "password" || /pass|secret|token|api.?key/i.test(hint),
  };
}

/** Codegen's order: role and name, then label, test id, placeholder, text, and `#id` last. */
export function specOf(d: Described): LocatorSpec | undefined {
  if (d.role && d.name) return { by: "role", value: d.role, name: d.name };
  if (d.label) return { by: "label", value: d.label };
  if (d.testid) return { by: "testid", value: d.testid };
  if (d.placeholder) return { by: "placeholder", value: d.placeholder };
  if (d.text && d.text.length <= 80) return { by: "text", value: d.text };
  if (d.id) return { by: "css", value: `#${d.id}` };
  return undefined;
}

export function locatorOf({ page, spec }: { page: Page; spec: LocatorSpec }): Locator {
  const builders: Record<LocatorSpec["by"], () => Locator> = {
    role: () =>
      page.getByRole(spec.value as Parameters<Page["getByRole"]>[0], {
        name: spec.name,
        exact: true,
      }),
    label: () => page.getByLabel(spec.value, { exact: true }),
    testid: () => page.getByTestId(spec.value),
    placeholder: () => page.getByPlaceholder(spec.value, { exact: true }),
    text: () => page.getByText(spec.value, { exact: true }),
    css: () => page.locator(spec.value),
  };
  const loc = builders[spec.by]();
  return spec.nth === undefined ? loc : loc.nth(spec.nth);
}

/** Describes the element a ref names, adding nth when the spec alone matches several. */
export async function recordLocator({
  page,
  target,
}: {
  page: Page;
  target: Locator;
}): Promise<{ spec: LocatorSpec; described: Described }> {
  const described = await target.evaluate(describeElement);
  const spec = specOf(described);
  if (!spec) throw new Error("no stable locator for this element (no role, label, id or text)");
  const matches = locatorOf({ page, spec });
  if ((await matches.count()) > 1) {
    const handle = await target.elementHandle();
    spec.nth = await matches.evaluateAll((els, el) => els.findIndex((e) => e === el), handle);
  }
  return { spec, described };
}

/** The app queries one response stands for: a tRPC batch is one per procedure. */
export function queriesOf({
  method,
  url,
  status,
  appHost,
}: {
  method: string;
  url: string;
  status: number;
  appHost: string;
}): Query[] {
  const { host, pathname } = new URL(url);
  if (host !== appHost || !pathname.startsWith("/api/")) return [];
  if (/^\/api\/(otel|rum)\//.test(pathname)) return [];
  const trpc = pathname.match(/^\/api\/trpc\/(.+)$/);
  const paths = trpc ? trpc[1]!.split(",").map((name) => `trpc:${name}`) : [pathname];
  return paths.map((path) => ({ method, path, status }));
}

const keyOf = (q: Query) => `${q.method} ${q.path} ${q.status}`;

/** Presence, not equality: polling may add queries, but a recorded one must come back. */
export function missingQuery({ expected, got }: { expected: Query[]; got: Query[] }) {
  const seen = new Set(got.map(keyOf));
  return expected.find((q) => !seen.has(keyOf(q)));
}

export function dedupe(queries: Query[]): Query[] {
  const seen = new Set<string>();
  return queries.filter((q) => !seen.has(keyOf(q)) && seen.add(keyOf(q)));
}
