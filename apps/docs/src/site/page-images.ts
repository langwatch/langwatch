/* Rewrites a prerendered page's authored images to modern formats and preloads the one a reader
   sees first. Works on the static HTML only; no island hydrates the article. */

/** One modern encoding of an authored image, at a site path under the build's base path. */
export type ImageVariant = { type: string; path: string; width: number };

/** An authored image's site path (without the base path) mapped to its modern encodings. */
export type ImageVariants = ReadonlyMap<string, readonly ImageVariant[]>;

/** The article column is at most 840px wide; smaller screens use the viewport. */
export const IMAGE_SIZES = "(min-width: 64rem) 840px, 100vw";

/* An image counts as above the fold while the article text before it fits the first screen. */
const FOLD_TEXT = 600;
const FOLD_HEADINGS = 1;
const RASTER = /\.(png|jpe?g)$/i;
const VOID = new Set(["img", "br", "hr", "input", "meta", "link", "source", "wbr", "col", "area"]);
const THEMES = { "docs-light-only": "light", "docs-dark-only": "dark" } as const;

type Theme = (typeof THEMES)[keyof typeof THEMES];

/** An authored article image found in a page, with what decides its loading. */
export type PageImage = {
  start: number;
  end: number;
  tag: string;
  src: string;
  visible: boolean;
  aboveFold: boolean;
  theme: Theme | null;
};

const decodeEntities = ({ value }: { value: string }) =>
  value.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

function attribute({ tag, name }: { tag: string; name: string }) {
  const match = new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag);
  return match ? decodeEntities({ value: match[1] ?? "" }) : null;
}

function themeOf({ classes }: { classes: string }): Theme | null {
  for (const [name, theme] of Object.entries(THEMES)) if (classes.includes(name)) return theme;
  return null;
}

/** The site path of a local raster `src`, or null for vectors, external and responsive images. */
export function localRaster({ src, basePath }: { src: string; basePath: string }) {
  if (!src.startsWith(`${basePath}/`) || src.startsWith("//")) return null;
  const sitePath = src.slice(basePath.length).split(/[?#]/)[0] ?? "";
  if (!RASTER.test(sitePath)) return null;
  try {
    return decodeURIComponent(sitePath);
  } catch {
    return null;
  }
}

type Open = { name: string; hidden: boolean; theme: Theme | null };
type Scan = {
  images: PageImage[];
  stack: Open[];
  text: number;
  headings: number;
  pictures: number;
};

const TAGS = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g;

function closeTag({ scan, name }: { scan: Scan; name: string }) {
  const at = scan.stack.findLastIndex((open) => open.name === name);
  if (at >= 0) scan.stack.length = at;
  if (name === "picture") scan.pictures -= 1;
}

function addImage({
  scan,
  tag,
  index,
  classes,
}: {
  scan: Scan;
  tag: string;
  index: number;
  classes: string;
}) {
  const src = attribute({ tag, name: "src" });
  if (!src || attribute({ tag, name: "srcSet" }) !== null) return;
  scan.images.push({
    start: index,
    end: index + tag.length,
    tag,
    src,
    visible: !scan.stack.some((open) => open.hidden),
    aboveFold: scan.text <= FOLD_TEXT && scan.headings <= FOLD_HEADINGS,
    theme: themeOf({ classes }) ?? scan.stack.findLast((open) => open.theme)?.theme ?? null,
  });
}

function openTag({ scan, match }: { scan: Scan; match: RegExpExecArray }) {
  const [tag, , rawName = "", attributes = "", selfClosing] = match;
  const name = rawName.toLowerCase();
  if (/^h[1-6]$/.test(name)) scan.headings += 1;
  if (name === "picture") scan.pictures += 1;
  const classes = attribute({ tag, name: "class" }) ?? "";
  if (name === "img" && /\bdocs-img\b/.test(classes) && scan.pictures === 0)
    addImage({ scan, tag, index: match.index, classes });
  if (selfClosing || VOID.has(name)) return;
  const hidden =
    /\shidden(=|\s|$)/.test(attributes) ||
    (name === "details" && !/\sopen(=|\s|$)/.test(attributes));
  scan.stack.push({ name, hidden, theme: themeOf({ classes }) });
}

/** Every `docs-img` in the page's article that is not already inside a `<picture>`. */
export function pageImages({ html }: { html: string }): PageImage[] {
  const article = html.search(/<article\b[^>]*\bdocs-prose\b/);
  if (article < 0) return [];
  const scan: Scan = { images: [], stack: [], text: 0, headings: 0, pictures: 0 };
  const tags = new RegExp(TAGS);
  tags.lastIndex = article;
  for (let match = tags.exec(html); match; match = tags.exec(html)) {
    const [, closing, name = "", , , words] = match;
    if (words !== undefined) scan.text += words.trim().length;
    else if (!closing) openTag({ scan, match });
    else {
      closeTag({ scan, name: name.toLowerCase() });
      if (scan.stack.length === 0) break;
    }
  }
  return scan.images;
}

function srcSet({ variants }: { variants: readonly ImageVariant[] }) {
  return variants.map((variant) => `${variant.path} ${variant.width}w`).join(", ");
}

function withLoading({ tag, eager }: { tag: string; eager: boolean }) {
  const loading = eager ? "eager" : "lazy";
  const set = (source: string, name: string, value: string) =>
    new RegExp(`\\s${name}="`).test(source)
      ? source.replace(new RegExp(`\\s${name}="[^"]*"`), ` ${name}="${value}"`)
      : source.replace(/\s*\/?>$/, ` ${name}="${value}"/>`);
  return set(set(tag, "loading", loading), "decoding", "async");
}

function picture({
  tag,
  variants,
  eager,
  first,
}: {
  tag: string;
  variants: readonly ImageVariant[];
  eager: boolean;
  first: boolean;
}) {
  const types = [...new Set(variants.map((variant) => variant.type))];
  const sources = types.map((type) => {
    const set = srcSet({ variants: variants.filter((variant) => variant.type === type) });
    return `<source type="${type}" srcset="${set}" sizes="${IMAGE_SIZES}"/>`;
  });
  let image = withLoading({ tag, eager });
  if (first) image = image.replace(/\s*\/?>$/, ` fetchpriority="high"/>`);
  return `<picture style="display:contents">${sources.join("")}${image}</picture>`;
}

function preloadLink({
  variants,
  theme,
}: {
  variants: readonly ImageVariant[];
  theme: Theme | null;
}) {
  const [type] = variants.map((variant) => variant.type);
  const chosen = variants.filter((variant) => variant.type === type);
  const media = theme ? ` media="(prefers-color-scheme: ${theme})"` : "";
  return `<link rel="preload" as="image" type="${type}" href="${chosen[0]?.path}" imagesrcset="${srcSet({ variants: chosen })}" imagesizes="${IMAGE_SIZES}" fetchpriority="high"${media}>`;
}

/** The first article image when it sits above the fold, with its theme partner if paired. */
function leadImages({ images }: { images: PageImage[] }) {
  const [lead, partner] = images;
  if (!lead?.visible || !lead.aboveFold) return new Set<PageImage>();
  if (!lead.theme) return new Set([lead]);
  const paired = partner?.visible && partner.theme && partner.theme !== lead.theme;
  return new Set(paired ? [lead, partner] : []);
}

function rewriteImage({
  image,
  found,
  first,
}: {
  image: PageImage;
  found: readonly ImageVariant[] | undefined;
  first: boolean;
}) {
  const eager = first && image.theme === null;
  if (found && found.length > 0) {
    const replacement = picture({ tag: image.tag, variants: found, eager, first });
    return {
      replacement,
      preload: first ? preloadLink({ variants: found, theme: image.theme }) : null,
    };
  }
  const replacement = withLoading({ tag: image.tag, eager });
  if (!first) return { replacement, preload: null };
  const media = image.theme ? ` media="(prefers-color-scheme: ${image.theme})"` : "";
  return {
    replacement: replacement.replace(/\s*\/?>$/, ` fetchpriority="high"/>`),
    preload: `<link rel="preload" as="image" href="${image.src}" fetchpriority="high"${media}>`,
  };
}

/**
 * Each authored raster offered as AVIF and WebP before its original. The first image above the
 * fold loads eagerly and is preloaded; a theme pair preloads each variant for its colour scheme
 * and stays lazy, so the hidden one is never fetched. Every other image loads lazily.
 */
export function rewritePageImages({
  html,
  variants,
  basePath,
}: {
  html: string;
  variants: ImageVariants;
  basePath: string;
}) {
  const images = pageImages({ html });
  const leads = leadImages({ images });
  const preloads: string[] = [];
  const parts: string[] = [];
  let cursor = 0;
  for (const image of images) {
    const sitePath = localRaster({ src: image.src, basePath });
    const found = sitePath ? variants.get(sitePath) : undefined;
    const { replacement, preload } = rewriteImage({ image, found, first: leads.has(image) });
    if (preload) preloads.push(preload);
    parts.push(html.slice(cursor, image.start), replacement);
    cursor = image.end;
  }
  const output = parts.join("") + html.slice(cursor);
  if (preloads.length === 0) return output;
  const title = output.indexOf("</title>");
  const at = title >= 0 ? title + "</title>".length : output.indexOf("</head>");
  return at < 0 ? output : output.slice(0, at) + preloads.join("") + output.slice(at);
}

/** Every local raster an authored article image names, as a site path. */
export function pageRasters({ html, basePath }: { html: string; basePath: string }) {
  return pageImages({ html }).flatMap((image) => {
    const sitePath = localRaster({ src: image.src, basePath });
    return sitePath ? [sitePath] : [];
  });
}
