/**
 * Reads the public changelog's RSS feed and an entry page into the sidebar's "What's new" card.
 * Plain pattern matching over the two shapes langwatch.ai publishes; anything else reads empty.
 * Spec: modules/navigation/specs/whats-new.feature
 */

/** One feed item: the guid is the entry's identity, the link its page. */
export type ChangelogFeedItem = Readonly<{
  id: string;
  title: string;
  url: string;
  publishedAt: string;
}>;

/** What an entry page adds to its feed item. */
export type ChangelogEntryDetail = Readonly<{
  imageUrl: string | null;
  features: { text: string; url: string }[];
}>;

const MAX_FEATURES = 4;
const FEATURES_HEADING = /<h2[^>]*>\s*What You Can Do Now\s*<\/h2>/i;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    }
    if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Tag-free, entity-decoded, whitespace-collapsed text. */
function plainText(html: string): string {
  const unwrapped = html.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, "");
  return decodeEntities(unwrapped).replace(/\s+/g, " ").trim();
}

function tagText({ xml, tag }: { xml: string; tag: string }): string {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
  return match?.[1] ? plainText(match[1]) : "";
}

/** The http(s) URL an href resolves to against the page: one, or none for anything else. */
function findHttpUrls({ href, base }: { href: string; base?: string }): string[] {
  try {
    const url = new URL(decodeEntities(href), base);
    return url.protocol === "https:" || url.protocol === "http:" ? [url.toString()] : [];
  } catch {
    return [];
  }
}

/** Feed items newest first, as the feed lists them; an item missing a title or link is skipped. */
export function parseChangelogFeed(xml: string): ChangelogFeedItem[] {
  const items: ChangelogFeedItem[] = [];
  for (const [, body = ""] of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const title = tagText({ xml: body, tag: "title" });
    const [url] = findHttpUrls({ href: tagText({ xml: body, tag: "link" }) });
    if (!title || !url) continue;
    items.push({
      id: tagText({ xml: body, tag: "guid" }) || url,
      title,
      url,
      publishedAt: tagText({ xml: body, tag: "pubDate" }),
    });
  }
  return items;
}

/**
 * The first screenshot and the "What You Can Do Now" lines: its h3 headings, else its list
 * items, each linking to the first link inside it or else to the entry itself.
 */
export function parseChangelogEntryPage({
  html,
  pageUrl,
}: {
  html: string;
  pageUrl: string;
}): ChangelogEntryDetail {
  const image = /<img\s[^>]*src="([^"]+)"/i.exec(html);
  const [imageUrl = null] = image?.[1] ? findHttpUrls({ href: image[1], base: pageUrl }) : [];

  const heading = FEATURES_HEADING.exec(html);
  if (!heading) return { imageUrl, features: [] };
  const rest = html.slice(heading.index + heading[0].length);
  const next = rest.search(/<h2[\s>]/i);
  const section = next === -1 ? rest : rest.slice(0, next);

  const headings = [...section.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)];
  const lines =
    headings.length > 0 ? headings : [...section.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
  const features = lines.slice(0, MAX_FEATURES).flatMap(([, inner = ""]) => {
    const text = plainText(inner);
    if (!text) return [];
    const href = /<a\s[^>]*href="([^"]+)"/i.exec(inner)?.[1];
    const [url = pageUrl] = href ? findHttpUrls({ href, base: pageUrl }) : [];
    return [{ text, url }];
  });
  return { imageUrl, features };
}
