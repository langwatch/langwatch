import type { ShareLink } from "@langwatch/share-contract";

/** A link stops working once it expires or its view cap is spent. */
export function isShareLinkSpent({
  link,
  now = new Date(),
}: {
  link: ShareLink;
  now?: Date;
}): boolean {
  const expired = !!link.expiresAt && link.expiresAt.getTime() <= now.getTime();
  const consumed = link.maxViews != null && link.viewCount >= link.maxViews;

  return expired || consumed;
}

/** The one-line summary under a link: its view budget, then its expiry. */
export function describeShareLink({
  link,
  now = new Date(),
}: {
  link: ShareLink;
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
  } else if (link.expiresAt.getTime() <= now.getTime()) {
    parts.push("Expired");
  } else {
    parts.push(`Expires ${link.expiresAt.toLocaleDateString()}`);
  }

  return parts.join(" · ");
}
