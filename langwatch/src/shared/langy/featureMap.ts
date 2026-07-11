/**
 * Typed access to `feature-map.json` — the canonical information architecture
 * at the repo root.
 *
 * Langy reaches LangWatch through the `langwatch` CLI, so a tool call is
 * `langwatch <resource> <verb>` (recorded by the server's CLI envelope as
 * `langwatch.<resource>.<verb>`). The map already lists every CLI command
 * against the feature that owns it, so the tool -> feature relation is DATA, not
 * a second table to hand-maintain. This module reads it once and exposes it as
 * typed lookups.
 *
 * What we take from the map is only what is TRUE OF THE FEATURE, whoever is
 * looking at it:
 *   - `surfaces.code.cli`  — the CLI commands the feature owns.
 *   - `produces`           — resource kinds a result of this feature contains.
 *   - `consumes`           — resource kinds this feature can act on.
 *
 * How a result LOOKS is not in the map and must not be: the Langy panel is one
 * view of these features among several (sidebar, docs, CLI itself), and each
 * binds its own rendering on top of the same facts. Langy's binding lives in
 * `capabilityRegistry.ts` (which surface, keyed by feature id — the card itself
 * comes from the shared `@langwatch/cli-cards` contract) and `cliFollowUps.ts`
 * (which offer, in which words) — so presentation can drift without structure.
 *
 * @see specs/langy/langy-cli-tool-envelope.feature
 */
import rawFeatureMap from "../../../../feature-map.json";

/** One feature (or sub-feature) of the map, reduced to what Langy needs. */
export interface FeatureNode {
  id: string;
  name: string;
  /** Resource kinds a result of this feature contains ("traces", "datasets"). */
  produces: string[];
  /** Resource kinds this feature can act on — the basis of a follow-up offer. */
  consumes: string[];
  /** The CLI commands this feature owns, e.g. `["trace search", "trace get"]`. */
  cli: string[];
}

/** A `langwatch <resource> <verb>` invocation, as the CLI envelope decodes it. */
export interface CliCommand {
  resource: string;
  verb: string;
}

interface RawFeature {
  id: string;
  name: string;
  children?: RawFeature[];
  surfaces?: { code?: { cli?: string[] | null } | null } | null;
  produces?: string[];
  consumes?: string[];
}

function flatten(features: RawFeature[]): RawFeature[] {
  return features.flatMap((feature) => [
    feature,
    ...flatten(feature.children ?? []),
  ]);
}

/** Every feature in the map, flattened, in map order. */
export const FEATURES: FeatureNode[] = flatten(
  (rawFeatureMap as { features: RawFeature[] }).features,
).map((feature) => ({
  id: feature.id,
  name: feature.name,
  produces: feature.produces ?? [],
  consumes: feature.consumes ?? [],
  cli: feature.surfaces?.code?.cli ?? [],
}));

/**
 * The `<resource> <verb>` pair a CLI command starts with. Deeper commands
 * (`dataset records list`, `prompt tag create`) collapse onto their first two
 * words, which is exactly the key the CLI envelope produces for them.
 */
function commandKey(command: string): string | null {
  const [resource, verb] = command.trim().split(/\s+/);
  return resource && verb ? `${resource}.${verb}` : null;
}

const FEATURE_BY_COMMAND: Map<string, FeatureNode> = (() => {
  const index = new Map<string, FeatureNode>();
  for (const feature of FEATURES) {
    for (const command of feature.cli) {
      const key = commandKey(command);
      // First feature to claim a command wins — the map has no duplicates today,
      // and a silent overwrite would be worse than a stable first-declared rule.
      if (key && !index.has(key)) index.set(key, feature);
    }
  }
  return index;
})();

/**
 * Decode the typed tool name the CLI envelope records
 * (`langwatch.<resource>.<verb>`) back into its command pair. Null for anything
 * else — a raw `bash`, a shell command that wasn't ours.
 */
export function parseCliToolName(name: string): CliCommand | null {
  const parts = name.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "langwatch") return null;
  const [, resource, verb] = parts;
  if (!resource || !verb) return null;
  return { resource, verb };
}

/** The feature that owns a CLI command, or undefined when the map doesn't list it. */
export function featureForCliCommand({
  resource,
  verb,
}: CliCommand): FeatureNode | undefined {
  return FEATURE_BY_COMMAND.get(`${resource}.${verb}`);
}

/** The feature behind a `langwatch.<resource>.<verb>` tool name. */
export function featureForCliToolName(name: string): FeatureNode | undefined {
  const command = parseCliToolName(name);
  return command ? featureForCliCommand(command) : undefined;
}

/** Features that can act on a resource kind — the candidates for a follow-up. */
export function featuresConsuming(kind: string): FeatureNode[] {
  return FEATURES.filter((feature) => feature.consumes.includes(kind));
}
