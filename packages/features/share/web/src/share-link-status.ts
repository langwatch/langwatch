import type { ShareLink } from "@langwatch/share-contract";

/**
 * A share link the way the BROWSER holds one.
 *
 * The contract types its instants as `Date` because that is what the server
 * builds; nothing transforms the wire, so what arrives here is the ISO string.
 * Parse it where a comparison needs a real instant.
 */
export type ShareLinkView = Omit<ShareLink, "expiresAt" | "createdAt" | "updatedAt"> & {
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** A link stops working once it expires or its view cap is spent. */
export function isShareLinkSpent({
  link,
  now = new Date(),
}: {
  link: ShareLinkView;
  now?: Date;
}): boolean {
  const expired = !!link.expiresAt && new Date(link.expiresAt).getTime() <= now.getTime();
  const consumed = link.maxViews != null && link.viewCount >= link.maxViews;

  return expired || consumed;
}

/** The one-line summary under a link: its view budget, then its expiry. */
export function describeShareLink({
  link,
  now = new Date(),
}: {
  link: ShareLinkView;
  now?: Date;
}): string {
  const parts: string[] = [];

  if (link.maxViews === 1) {
    parts.push(link.viewCount >= 1 ? "Opened" : "Opens once");
  } else if (link.maxViews != null) {
    parts.push(`${link.viewCount} of ${link.maxViews} views`);
  }

  if (!link.expiresAt) {
    parts.push("No expiry");
  } else if (new Date(link.expiresAt).getTime() <= now.getTime()) {
    parts.push("Expired");
  } else {
    parts.push(`Expires ${new Date(link.expiresAt).toLocaleDateString()}`);
  }

  return parts.join(" · ");
}
