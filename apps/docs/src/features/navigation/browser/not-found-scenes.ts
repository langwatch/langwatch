import { LOGO_LINES_PATH } from "@langwatch/design-system/logo-paths";

import { pagePath } from "../../../lib/site-path.ts";
import type { NotFoundScene, Suggestion } from "../model/not-found.ts";

/* The engineering and product scenes of the 404 page, built in the browser once the missing
   address is known. Text is set as text, never as markup, so an address cannot inject any. */
type Child = Node | string | null;

function h(tag: string, attributes: Record<string, string> = {}, ...children: Child[]) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  element.append(...children.filter((child) => child !== null));
  return element;
}

const span = (className: string, ...children: Child[]) =>
  h("span", { class: className }, ...children);

export type SceneInput = {
  /** The address as the reader asked for it, base path included. */
  shown: string;
  host: string;
  pages: Suggestion[];
  query: string;
};

const SVG = "http://www.w3.org/2000/svg";

/** A 16px stroke icon from Lucide path data, built as nodes like everything else here. */
function icon(...paths: string[]) {
  const svg = document.createElementNS(SVG, "svg");
  for (const [name, value] of Object.entries({
    viewBox: "0 0 24 24",
    width: "16",
    height: "16",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    class: "docs-nf-icon",
  }))
    svg.setAttribute(name, value);
  for (const d of paths) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

const ALERT = ["M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0", "M12 8v4", "M12 16h.01"];

/** The closest pages: numbered rows in the terminal, cards elsewhere; keys 1 to 3 open them. */
export function picks({ pages, label }: { pages: Suggestion[]; label: string }) {
  return h(
    "ol",
    { class: "docs-nf-picks", "aria-label": label },
    ...pages.map((page, index) => {
      const href = pagePath({ slug: page.slug });
      return h(
        "li",
        {},
        h(
          "a",
          { href, "data-nf-pick": String(index + 1) },
          span("docs-nf-num", String(index + 1)),
          span("docs-nf-title", page.title),
          span("docs-nf-where", href),
          span("docs-nf-go", icon("M5 12h14", "m12 5 7 7-7 7")),
        ),
      );
    }),
  );
}

const line = (...children: Child[]) => h("p", { class: "docs-nf-line" }, ...children);
/** A line that starts a new block of the session, after a blank line as Claude Code prints. */
const block = (...children: Child[]) => h("p", { class: "docs-nf-line is-block" }, ...children);

/** Langy's mark: the LangWatch box in the orange to purple gradient, as in the app. */
function langyMark() {
  const svg = document.createElementNS(SVG, "svg");
  for (const [name, value] of Object.entries({
    viewBox: "0 0 38 52",
    width: "30",
    height: "41",
    class: "docs-nf-langy",
    "aria-hidden": "true",
  }))
    svg.setAttribute(name, value);
  const defs = document.createElementNS(SVG, "defs");
  const gradient = document.createElementNS(SVG, "linearGradient");
  for (const [name, value] of Object.entries({
    id: "docs-nf-langy",
    x1: "0",
    y1: "1",
    x2: "1",
    y2: "0",
  }))
    gradient.setAttribute(name, value);
  for (const { offset, className } of [
    { offset: "0", className: "is-orange" },
    { offset: "1", className: "is-purple" },
  ]) {
    const stop = document.createElementNS(SVG, "stop");
    stop.setAttribute("offset", offset);
    stop.setAttribute("class", className);
    gradient.append(stop);
  }
  defs.append(gradient);
  const mark = document.createElementNS(SVG, "path");
  mark.setAttribute("d", LOGO_LINES_PATH);
  mark.setAttribute("fill", "url(#docs-nf-langy)");
  svg.append(defs, mark);
  return svg;
}

/** A Langy Code session laid out like the app's terminal view: banner, entries, status line. */
function terminal({ shown, host, pages, query }: SceneInput) {
  const input = h("input", {
    type: "text",
    "data-docs-search": "",
    "data-docs-search-query": query,
    "aria-label": "Search the docs",
    placeholder: "Type to search the docs",
    autocomplete: "off",
    spellcheck: "false",
  });
  const shortcuts = h(
    "p",
    { class: "docs-nf-line docs-nf-dim", "data-nf-shortcuts": "", hidden: "" },
    "1-3 open a page · / search the docs · ? hide shortcuts",
  );
  return h(
    "div",
    { class: "docs-nf-term" },
    h(
      "div",
      { class: "docs-nf-banner" },
      langyMark(),
      h(
        "div",
        {},
        h("p", {}, h("strong", {}, "Langy Code")),
        h("p", { class: "docs-nf-dim" }, "Langy · documentation agent"),
        h("p", { class: "docs-nf-dim" }, `${host}`),
      ),
    ),
    h("p", { class: "docs-nf-rule", "aria-hidden": "true" }, "session start"),
    block(span("docs-nf-caret", "❯ "), `open ${shown}`),
    block(
      span("docs-nf-red", "⏺ "),
      h("strong", {}, "Fetch"),
      span("docs-nf-dim", `(${host}${shown})`),
    ),
    line(span("docs-nf-dim", "  ⎿  "), span("docs-nf-red", "404 Not found")),
    pages.length
      ? block(span("docs-nf-bullet", "⏺ "), "That page does not exist. The closest pages are:")
      : block(span("docs-nf-bullet", "⏺ "), "That page does not exist. Try a search instead."),
    pages.length ? picks({ pages, label: "Closest pages" }) : null,
    h(
      "div",
      { class: "docs-nf-status" },
      h("label", { class: "docs-nf-input" }, span("docs-nf-caret", "❯"), input),
      h(
        "p",
        { class: "docs-nf-line docs-nf-hints" },
        h(
          "span",
          {},
          span("docs-nf-accent", "⏵⏵ "),
          span("docs-nf-dim", "1-3 open a page · / search · ? shortcuts"),
        ),
        h("span", {}, span("docs-nf-dim", "1 step · 0 tokens · "), span("docs-nf-accent", "404")),
      ),
      shortcuts,
    ),
  );
}

type SpanRow = { name: Child; mark: Child; ms: string; bar: string; className: string };

/** One span of the trace: its name, where it sits on the 2 ms timeline, and its duration. */
function spanRow({ name, mark, ms, bar, className }: SpanRow) {
  return h(
    "div",
    { class: `docs-nf-span ${className}` },
    h("span", { class: "docs-nf-span-name" }, mark, name),
    h("span", { class: "docs-nf-bar", "aria-hidden": "true" }, h("i", { style: `width:${bar}` })),
    span("docs-nf-ms", ms),
  );
}

/** The website's 404 trace: the route did not match, so `page_exists` failed. */
function trace({ shown, pages }: SceneInput) {
  return h(
    "figure",
    { class: "docs-nf-trace", "aria-label": "Illustrative trace of the missing page request" },
    h(
      "div",
      { class: "docs-nf-trace-head" },
      h(
        "span",
        {},
        icon(
          "M6 3v12",
          "M18 6m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
          "M6 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
          "M18 9a9 9 0 0 1-9 9",
        ),
        h("strong", {}, "Page request"),
        span("docs-nf-dim", "3 spans"),
      ),
      span("docs-nf-badge", icon(...ALERT), "404 NOT_FOUND"),
    ),
    h(
      "div",
      { class: "docs-nf-spans" },
      h(
        "div",
        { class: "docs-nf-span is-axis", "aria-hidden": "true" },
        span("", "Span"),
        span("docs-nf-axis", span("", "0 ms"), span("", "1 ms"), span("", "2 ms")),
        span("docs-nf-ms", "Duration"),
      ),
      spanRow({
        name: h("code", {}, `GET ${shown}`),
        mark: icon("m6 9 6 6 6-6"),
        ms: "2.0 ms",
        bar: "100%",
        className: "is-root",
      }),
      spanRow({
        name: h(
          "span",
          { class: "docs-nf-label" },
          h("code", {}, "route.match"),
          span("docs-nf-note", "404 NOT_FOUND"),
        ),
        mark: icon(...ALERT),
        ms: "1.4 ms",
        bar: "70%",
        className: "is-failed",
      }),
      h(
        "div",
        { class: "docs-nf-eval" },
        h(
          "p",
          {},
          span("docs-nf-dim", "Evaluation"),
          h("code", {}, "page_exists"),
          span("docs-nf-badge", icon("M18 6 6 18", "m6 6 12 12"), "FAIL"),
        ),
        h(
          "dl",
          {},
          h("div", {}, h("dt", {}, "Expected"), h("dd", {}, "200 OK")),
          h("div", {}, h("dt", {}, "Received"), h("dd", { class: "is-bad" }, "404 Not Found")),
        ),
      ),
      spanRow({
        name: h(
          "span",
          { class: "docs-nf-label" },
          h("code", {}, "render"),
          span("docs-nf-note", "skipped"),
        ),
        mark: icon("M5 12h14"),
        ms: "0.0 ms",
        bar: "0%",
        className: "is-skipped",
      }),
    ),
    pages.length
      ? h(
          "nav",
          { class: "docs-nf-fix", "aria-label": "Suggested pages" },
          h(
            "p",
            { class: "docs-nf-fix-head" },
            h("strong", {}, "Langy’s suggested fix"),
            span("docs-nf-dim", "Try one of these nearby pages."),
          ),
          picks({ pages, label: "Closest pages" }),
        )
      : null,
    h(
      "figcaption",
      {},
      span("", "No matching route. Nothing to render."),
      span("docs-nf-faint", "Illustrative trace · timings are examples"),
    ),
  );
}

/** The scene's content, or null for the castle, which the page already holds. */
export function sceneContent({ scene, input }: { scene: NotFoundScene; input: SceneInput }) {
  if (scene === "engineering") return terminal(input);
  if (scene === "product") return trace(input);
  return null;
}
