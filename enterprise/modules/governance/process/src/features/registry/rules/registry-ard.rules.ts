// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  ARD_AGENT_CARD_MEDIA_TYPE,
  ARD_CONTEXT,
  ARD_SPEC_VERSION,
  type AgentRegistryEntry,
  type ArdEntry,
  type ArdManifest,
  type ArdSearchRequest,
  type ArdSearchResponse,
} from "@langwatch/enterprise-governance-contract";

/** The publisher an ARD identifier names: the host LangWatch is served from. */
export function ardPublisherOf(publicBaseUrl: string): string {
  try {
    return new URL(publicBaseUrl).hostname || "langwatch.local";
  } catch {
    return "langwatch.local";
  }
}

/** URN segments carry only unreserved characters; anything else becomes `-`. */
function urnSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-");
}

/** `urn:air:<publisher>:<organization id>:agent:<registry id>`, per ARD v0.91 identifiers. */
function ardIdentifier({
  publisher,
  organizationId,
  entryId,
}: {
  publisher: string;
  organizationId: string;
  entryId: string;
}): string {
  return `urn:air:${publisher}:${urnSegment(organizationId)}:agent:${urnSegment(entryId)}`;
}

/** One registry entry as an ARD entry with the entry inline as its agent card. */
function ardEntryOf({
  entry,
  publisher,
  organizationId,
}: {
  entry: AgentRegistryEntry;
  publisher: string;
  organizationId: string;
}): ArdEntry {
  const tags = [entry.source, entry.management, entry.kind];
  if (entry.environment) tags.push(entry.environment);
  return {
    "@context": ARD_CONTEXT,
    identifier: ardIdentifier({ publisher, organizationId, entryId: entry.id }),
    displayName: entry.name,
    type: ARD_AGENT_CARD_MEDIA_TYPE,
    ...(entry.description ? { description: entry.description } : {}),
    version: String(entry.version),
    updatedAt: entry.updated_at,
    tags,
    capabilities: entry.capabilities,
    data: entry,
    metadata: {
      "langwatch:registryId": entry.id,
      "langwatch:source": entry.source,
      "langwatch:management": entry.management,
      "langwatch:status": entry.status,
    },
  };
}

/** The organisation's manifest: active entries only, removed agents are not discoverable. */
export function ardManifestOf({
  entries,
  publisher,
  organizationId,
  updatedAt,
}: {
  entries: readonly AgentRegistryEntry[];
  publisher: string;
  organizationId: string;
  updatedAt: string;
}): ArdManifest {
  return {
    specVersion: ARD_SPEC_VERSION,
    publisher,
    updatedAt,
    entries: entries
      .filter((entry) => entry.status === "active")
      .map((entry) => ardEntryOf({ entry, publisher, organizationId })),
  };
}

/** The value a filter key reads off an ARD entry: a top-level term or a `data.` path. */
function termValues(entry: ArdEntry, path: string): string[] {
  const read = (root: unknown, segments: string[]): unknown =>
    segments.reduce<unknown>(
      (value, segment) =>
        value !== null && typeof value === "object"
          ? (value as Record<string, unknown>)[segment]
          : undefined,
      root,
    );
  const direct = read(entry, path.split("."));
  const value = direct === undefined ? read(entry.data, path.split(".")) : direct;
  const text = (item: unknown) => (typeof item === "string" ? item : JSON.stringify(item));
  if (Array.isArray(value)) return value.map(text);
  return value === undefined || value === null ? [] : [text(value)];
}

function matchesFilter(entry: ArdEntry, filter: Record<string, string[]> | undefined): boolean {
  if (!filter) return true;
  return Object.entries(filter).every(([path, accepted]) => {
    const values = termValues(entry, path).map((value) => value.toLowerCase());
    return accepted.some((wanted) => values.includes(wanted.toLowerCase()));
  });
}

function haystackOf(entry: ArdEntry): { strong: string; weak: string } {
  const tools = entry.data.tools.map((tool) => `${tool.name} ${tool.description ?? ""}`);
  return {
    strong: `${entry.displayName} ${entry.capabilities.join(" ")}`.toLowerCase(),
    weak: [entry.description ?? "", entry.tags.join(" "), entry.data.instructions ?? "", ...tools]
      .join(" ")
      .toLowerCase(),
  };
}

/** Share of query words found, name and capabilities weighing double; 0 to 100. */
function ardScore(entry: ArdEntry, text: string): number {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const { strong, weak } = haystackOf(entry);
  const weigh = (word: string): number => {
    if (strong.includes(word)) return 2;
    if (weak.includes(word)) return 1;
    return 0;
  };
  const points = words.reduce((sum, word) => sum + weigh(word), 0);
  return Math.round((points / (words.length * 2)) * 100);
}

/** ARD `POST /search`: filter, score, drop the unmatched, rank, page by offset token. */
export function ardSearch({
  manifest,
  request,
}: {
  manifest: ArdManifest;
  request: ArdSearchRequest;
}): ArdSearchResponse {
  const offset = request.pageToken ? Number(request.pageToken) : 0;
  const ranked = manifest.entries
    .filter((entry) => matchesFilter(entry, request.query.filter))
    .map((entry) => ({ ...entry, score: ardScore(entry, request.query.text) }))
    .filter((entry) => entry.score > 0)
    .toSorted((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));
  const page = ranked.slice(offset, offset + request.pageSize);
  const next = offset + request.pageSize;
  return { results: page, ...(next < ranked.length ? { pageToken: String(next) } : {}) };
}
