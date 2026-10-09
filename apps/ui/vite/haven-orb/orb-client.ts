import havenIcon from "@langwatch/design-system-internal/assets/haven.svg";
import { nowInstant } from "@langwatch/time";
import { z } from "zod";

import {
  buildFeedback,
  describeTarget,
  type Box,
  havenEndpoint,
  postToHaven,
  snapshotPage,
  type Subject,
} from "./feedback";
import {
  currentTheme,
  hideForSession,
  isHiddenForSession,
  setTheme,
  THEME_LABELS,
  THEMES,
} from "./orb-prefs";
import { ORB_STYLES } from "./orb-styles";
import { attachPageBuffer, type PageBuffer } from "./page-buffer";
import { pickElement, selectRegion } from "./pickers";

/** The orb pushes the page buffer to haven at most this often, for `haven page`. */
const PUSH_EVERY_MS = 2_000;

const factsSchema = z.object({
  slug: z.string(),
  branch: z.string(),
  commit: z.string(),
  links: z.array(z.object({ label: z.string(), href: z.string().regex(/^https?:\/\//u) })),
});
type Facts = z.infer<typeof factsSchema>;

type Host = Window & typeof globalThis;
type Orb = {
  host: Host;
  buffer: PageBuffer;
  send: typeof fetch;
  endpoint: ReturnType<typeof havenEndpoint>;
};

const make = <K extends keyof HTMLElementTagNameMap>({
  doc,
  tag,
  text,
  attrs = {},
}: {
  doc: Document;
  tag: K;
  text?: string;
  attrs?: Record<string, string>;
}): HTMLElementTagNameMap[K] => {
  const element = doc.createElement(tag);
  if (text) element.textContent = text;
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  return element;
};

const loadFacts = async ({ send, endpoint }: Orb): Promise<Facts | undefined> => {
  try {
    const response = await send(endpoint.base);
    if (!response.ok) return undefined;
    const parsed = factsSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

const pushEvery = ({ host, buffer, send, endpoint }: Orb) => {
  let pending: number | undefined;
  buffer.subscribe({
    listener: () => {
      if (pending !== undefined) return;
      pending = host.setTimeout(() => {
        pending = undefined;
        const body = snapshotPage({ buffer, href: host.location.href });
        void postToHaven({ send, url: `${endpoint.base}/page`, body });
      }, PUSH_EVERY_MS);
    },
  });
};

const describeSubject = ({ subject }: { subject: Subject }): string => {
  if (subject.kind === "region") {
    const { x, y, width, height } = subject.box;
    return `Region ${Math.round(width)}×${Math.round(height)} at ${Math.round(x)}, ${Math.round(y)}`;
  }
  const { selector, text } = describeTarget({ element: subject.element });
  return text ? `${selector} "${text.slice(0, 40)}"` : selector;
};

const debugInfo = ({ host, stack }: { host: Window; stack: string }) =>
  JSON.stringify(
    {
      page: host.location.href,
      stack,
      viewport: `${host.innerWidth}×${host.innerHeight}`,
      userAgent: host.navigator.userAgent,
      at: nowInstant().toString(),
    },
    null,
    2,
  );

type El = ReturnType<typeof elFor>;

const elFor =
  ({ doc }: { doc: Document }) =>
  <K extends keyof HTMLElementTagNameMap>(spec: {
    tag: K;
    text?: string;
    attrs?: Record<string, string>;
  }) =>
    make({ doc, ...spec });

const rowOf = ({ el, children }: { el: El; children: HTMLElement[] }) => {
  const div = el({ tag: "div", attrs: { class: "row" } });
  div.append(...children);
  return div;
};

const buildThemeButtons = ({ host, el }: { host: Host; el: El }) => {
  const buttons = THEMES.map((theme) => {
    const button = el({
      tag: "button",
      text: THEME_LABELS[theme],
      attrs: { "aria-pressed": String(currentTheme({ host }) === theme) },
    });
    button.addEventListener("click", () => {
      setTheme({ host, theme });
      buttons.forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
    });
    return button;
  });
  return buttons;
};

const elementSubject = ({ element }: { element: Element | undefined }): Subject | undefined =>
  element ? { kind: "element", element } : undefined;

const regionSubject = ({ box }: { box: Box | undefined }): Subject | undefined =>
  box ? { kind: "region", box } : undefined;

const showSubject = ({
  next,
  panel,
  form,
  subjectLine,
  textarea,
}: {
  next: Subject | undefined;
  panel: HTMLElement;
  form: HTMLFormElement;
  subjectLine: HTMLElement;
  textarea: HTMLTextAreaElement;
}) => {
  panel.hidden = false;
  form.hidden = next === undefined;
  subjectLine.textContent = next ? describeSubject({ subject: next }) : "";
  if (next) textarea.focus();
};

const reportSent = ({
  sent,
  status,
  textarea,
  clear,
}: {
  sent: boolean;
  status: HTMLElement;
  textarea: HTMLTextAreaElement;
  clear: () => void;
}) => {
  status.textContent = sent
    ? "Sent. An agent reads it with `haven feedback list --open`."
    : "Haven did not take it: is the stack up?";
  if (!sent) return;
  textarea.value = "";
  clear();
};

type PanelParts = { orb: Orb; el: El; panel: HTMLElement; status: HTMLElement };

const buildFeedbackForm = ({
  orb,
  el,
  panel,
  status,
  layer,
  shell,
}: PanelParts & { layer: HTMLElement; shell: HTMLElement }) => {
  const { host, buffer, send, endpoint } = orb;
  const form = el({ tag: "form" });
  form.hidden = true;
  const subjectLine = el({ tag: "p", attrs: { class: "muted" } });
  const textarea = el({
    tag: "textarea",
    attrs: { rows: "4", "aria-label": "Feedback note", placeholder: "What should change here?" },
  });
  const submit = el({ tag: "button", text: "Send to haven", attrs: { type: "submit" } });
  const cancel = el({ tag: "button", text: "Cancel", attrs: { type: "button" } });
  form.append(subjectLine, textarea, rowOf({ el, children: [submit, cancel] }));
  const state: { subject?: Subject } = {};
  const ask = (next: Subject | undefined) => {
    state.subject = next;
    showSubject({ next, panel, form, subjectLine, textarea });
  };

  const pickButton = el({ tag: "button", text: "Pick element" });
  pickButton.addEventListener("click", () => {
    panel.hidden = true;
    void pickElement({ host, layer, isOwn: (candidate) => candidate === shell }).then((element) =>
      ask(elementSubject({ element })),
    );
  });
  const regionButton = el({ tag: "button", text: "Select region" });
  regionButton.addEventListener("click", () => {
    panel.hidden = true;
    void selectRegion({ host, layer }).then((box) => ask(regionSubject({ box })));
  });
  cancel.addEventListener("click", () => ask(undefined));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const note = textarea.value.trim();
    const { subject } = state;
    if (!subject || !note) return;
    submit.disabled = true;
    const body = buildFeedback({ note, subject, buffer, host });
    void postToHaven({ send, url: `${endpoint.base}/feedback`, body }).then((sent) => {
      submit.disabled = false;
      reportSent({ sent, status, textarea, clear: () => ask(undefined) });
    });
  });
  return { form, pickButton, regionButton };
};

const copyDebug = ({
  host,
  where,
  status,
}: {
  host: Host;
  where: HTMLElement;
  status: HTMLElement;
}) => {
  const info = debugInfo({ host, stack: where.textContent ?? "" });
  void host.navigator.clipboard.writeText(info).then(
    () => {
      status.textContent = "Copied debug info.";
    },
    () => {
      status.textContent = "The browser refused the clipboard.";
    },
  );
};

const buildFooter = ({
  orb,
  el,
  status,
  where,
  shell,
}: PanelParts & { where: HTMLElement; shell: HTMLElement }) => {
  const { host } = orb;
  const copy = el({ tag: "button", text: "Copy debug info" });
  copy.addEventListener("click", () => copyDebug({ host, where, status }));
  const api = el({
    tag: "a",
    text: "Open API",
    attrs: { href: `${host.location.origin}/api`, target: "_blank", rel: "noreferrer" },
  });
  const hide = el({ tag: "button", text: "Hide for this session" });
  hide.addEventListener("click", () => {
    hideForSession({ host });
    shell.remove();
  });
  return [copy, api, hide];
};

const renderFacts = ({
  facts,
  orb,
  el,
  where,
  links,
}: {
  facts: Facts | undefined;
  orb: Orb;
  el: El;
  where: HTMLElement;
  links: HTMLElement;
}) => {
  const { endpoint } = orb;
  if (!facts) {
    where.textContent = `${endpoint.slug} · haven did not answer`;
    return;
  }
  where.textContent = [facts.slug, facts.branch, facts.commit].filter(Boolean).join(" · ");
  const home = { label: "Home", href: new URL(endpoint.base).origin };
  links.replaceChildren(
    ...[home, ...facts.links].map(({ label, href }) =>
      el({ tag: "a", text: label, attrs: { href, target: "_blank", rel: "noreferrer" } }),
    ),
  );
};

const wireToggle = ({
  orb,
  el,
  toggle,
  panel,
  where,
  links,
}: {
  orb: Orb;
  el: El;
  toggle: HTMLElement;
  panel: HTMLElement;
  where: HTMLElement;
  links: HTMLElement;
}) => {
  let asked = false;
  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
    if (asked) return;
    asked = true;
    void loadFacts(orb).then((facts) => renderFacts({ facts, orb, el, where, links }));
  });
};

/** The orb and its panel, in a shadow root so the app's styles and the orb's never meet. */
function mountPanel(orb: Orb) {
  const { host, endpoint } = orb;
  const doc = host.document;
  const el = elFor({ doc });
  const shell = el({ tag: "div", attrs: { "data-haven-orb": "" } });
  const root = shell.attachShadow({ mode: "open" });
  const toggle = el({
    tag: "button",
    attrs: { class: "orb", "aria-label": "Haven dev tools", "aria-expanded": "false" },
  });
  toggle.append(el({ tag: "img", attrs: { src: havenIcon, alt: "" } }));
  const panel = el({ tag: "section", attrs: { class: "panel", "aria-label": "Haven dev tools" } });
  panel.hidden = true;
  const where = el({
    tag: "p",
    text: `${endpoint.slug} · asking haven…`,
    attrs: { class: "muted" },
  });
  const links = el({ tag: "nav", attrs: { class: "row", "aria-label": "Stack consoles" } });
  const status = el({ tag: "p", attrs: { class: "muted", role: "status" } });
  const layer = el({ tag: "div", attrs: { class: "layer" } });
  const parts = { orb, el, panel, status };

  const { form, pickButton, regionButton } = buildFeedbackForm({ ...parts, layer, shell });
  wireToggle({ orb, el, toggle, panel, where, links });
  panel.append(
    where,
    rowOf({ el, children: buildThemeButtons({ host, el }) }),
    links,
    rowOf({ el, children: [pickButton, regionButton] }),
    form,
    rowOf({ el, children: buildFooter({ ...parts, where, shell }) }),
    status,
  );
  root.append(el({ tag: "style", text: ORB_STYLES }), panel, toggle, layer);
  doc.body.append(shell);
}

/** Injected first in the head by the dev server, so the buffer sees the first request. */
function start({ host }: { host: Host }) {
  const send = host.fetch.bind(host);
  const buffer = attachPageBuffer({ host });
  const orb: Orb = { host, buffer, send, endpoint: havenEndpoint({ location: host.location }) };
  pushEvery(orb);
  if (isHiddenForSession({ host })) return;
  if (host.document.readyState === "loading") {
    host.document.addEventListener("DOMContentLoaded", () => mountPanel(orb), { once: true });
    return;
  }
  mountPanel(orb);
}

start({ host: window });
