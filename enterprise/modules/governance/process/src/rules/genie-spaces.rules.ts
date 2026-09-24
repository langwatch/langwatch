// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { z } from "zod";

import type { DiscoveredAgentRecord } from "./agent-listing.rules.ts";

export const GENIE_SPACES_PATH = "/api/2.0/genie/spaces";

const spaceSchema = z
  .object({
    space_id: z.string(),
    title: z.string().nullable().default(null),
  })
  .passthrough();

export type GenieSpace = z.infer<typeof spaceSchema>;

const spacesPageSchema = z.object({
  spaces: z.array(spaceSchema).default([]),
  next_page_token: z.string().nullable().default(null),
});

/**
 * Walks `/api/2.0/genie/spaces` through a page reader the caller owns.
 *
 * `complete` is false when `stop` cut the walk short, which is the same signal
 * the sweep's `PagedRead` carries: a truncated list has no trustworthy position
 * in it, so the sweep restarts from the top rather than resuming into it.
 *
 * The repeated-token check is not defensive tidiness. A server that hands back
 * a token it already served would otherwise spin this loop until the deadline,
 * spending the whole run on one endpoint.
 */
export async function walkGenieSpaces(params: {
  /** Reads one page. Throws on failure; the caller decides what that costs. */
  readPage: (query: Record<string, string>) => Promise<unknown>;
  /** Asked before every page. True stops the walk and marks it incomplete. */
  stop: () => boolean;
  pageSize: number;
}): Promise<{ spaces: GenieSpace[]; complete: boolean }> {
  const { readPage, stop, pageSize } = params;
  const spaces: GenieSpace[] = [];
  let page: string | null = null;
  const seen = new Set<string>();

  while (!stop()) {
    const parsed = spacesPageSchema.parse(
      await readPage({
        page_size: String(pageSize),
        ...(page ? { page_token: page } : {}),
      }),
    );
    spaces.push(...parsed.spaces);

    if (parsed.next_page_token === null) return { spaces, complete: true };
    if (seen.has(parsed.next_page_token)) {
      throw new Error(
        `databricks genie ${GENIE_SPACES_PATH} returned a page_token it had already served; refusing to re-read pages in a cycle`,
      );
    }
    seen.add(parsed.next_page_token);
    page = parsed.next_page_token;
  }

  return { spaces, complete: false };
}

/**
 * The workspace host a space belongs to, for the agent row's metadata.
 *
 * The host rather than the configured URL: two sources pointed at the same
 * workspace through addresses that differ only in a trailing slash would
 * otherwise write two different metadata values for the same agent.
 */
function workspaceHostOf(workspaceUrl: string): string {
  try {
    return new URL(workspaceUrl).host;
  } catch {
    return "";
  }
}

/** Genie spaces as `DiscoveredAgent` rows. */
export function genieSpacesAsAgents(params: {
  spaces: GenieSpace[];
  workspaceUrl: string;
}): DiscoveredAgentRecord[] {
  const workspaceHost = workspaceHostOf(params.workspaceUrl);
  const metadata: Record<string, string> = workspaceHost === "" ? {} : { workspaceHost };
  return params.spaces.map((space) => ({
    rawAgentId: space.space_id,
    // The id is the fallback rather than a blank. A space whose title the
    // workspace withheld still has to render as something a person can find.
    displayText: space.title?.trim() ? space.title.trim() : space.space_id,
    metadata: { ...metadata },
  }));
}
