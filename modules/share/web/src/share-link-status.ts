import type { ShareLink } from "@langwatch/share-contract";
import { type Instant, nowInstant, toEpochMs } from "@langwatch/time";
import { readableDate } from "./readable-date.ts";

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
  now = nowInstant(),
}: {
  link: ShareLinkView;
  now?: Instant;
}): boolean {
  const expired = !!link.expiresAt && toEpochMs(link.expiresAt) <= now.epochMilliseconds;
  const consumed = link.maxViews != null && link.viewCount >= link.maxViews;

  return expired || consumed;
}

/** The one-line summary under a link: its view budget, then its expiry. */
export function describeShareLink({
  link,
  now = nowInstant(),
}: {
  link: ShareLinkView;
  now?: Instant;
}): string {
  const parts: string[] = [];

  if (link.maxViews === 1) {
    parts.push(link.viewCount >= 1 ? "Opened" : "Opens once");
  } else if (link.maxViews != null) {
    parts.push(`${link.viewCount} of ${link.maxViews} views`);
  }

  if (!link.expiresAt) {
    parts.push("No expiry");
  } else if (toEpochMs(link.expiresAt) <= now.epochMilliseconds) {
    parts.push("Expired");
  } else {
    parts.push(`Expires ${readableDate(link.expiresAt).toLocaleDateString()}`);
  }

  return parts.join(" · ");
}
