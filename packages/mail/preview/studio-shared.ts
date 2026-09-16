export interface TemplateSummary {
  id: string;
  title: string;
  sentWhen: string;
  fixtures: { name: string; props: unknown }[];
  formSchema: unknown;
}

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

export interface GalleryEntry {
  template: string;
  title: string;
  fixture: string;
  subject: string;
  html: string;
  text: string;
}

export const WIDTHS = { desktop: 680, mobile: 375 } as const;

/**
 * Shows the dark half of an email without asking the OS to change — nothing
 * lets a page force `prefers-color-scheme` on a frame. Promotes the
 * email's own dark rules, so it renders what a client composes, not a second preview theme.
 */
export const promoteDarkRules = (html: string): string => {
  const marker = "@media (prefers-color-scheme: dark)";
  let out = "";
  let cursor = 0;
  for (;;) {
    const start = html.indexOf(marker, cursor);
    if (start === -1) return out + html.slice(cursor);
    const open = html.indexOf("{", start + marker.length);
    if (open === -1) return out + html.slice(cursor);
    let depth = 1;
    let index = open + 1;
    while (index < html.length && depth > 0) {
      if (html[index] === "{") depth += 1;
      else if (html[index] === "}") depth -= 1;
      index += 1;
    }
    out += html.slice(cursor, start) + html.slice(open + 1, index - 1);
    cursor = index;
  }
};

/** "system" defers to the studio's own resolved colour scheme. */
export type PreviewScheme = "light" | "dark" | "system";

const CENTER_STYLE =
  "<style>html,body{margin:0 !important;}body{display:flex !important;" +
  "justify-content:center !important;}</style>";

/**
 * Centres the mail inside the iframe's own viewport, at every width the
 * studio offers — a narrower mobile frame would otherwise leave the message
 * pinned to the left edge instead of centred the way a mail client shows it.
 */
const centerDocument = (html: string): string => {
  const headOpen = html.indexOf("<head");
  if (headOpen === -1) return CENTER_STYLE + html;
  const headEnd = html.indexOf(">", headOpen);
  if (headEnd === -1) return CENTER_STYLE + html;
  return html.slice(0, headEnd + 1) + CENTER_STYLE + html.slice(headEnd + 1);
};

/** The one place an iframe document is prepared, for Inspect and the gallery alike. */
export const prepareMailDocument = (html: string, dark: boolean): string =>
  centerDocument(dark ? promoteDarkRules(html) : html);
