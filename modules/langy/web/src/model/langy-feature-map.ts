import { z } from "zod";

/**
 * @see specs/langy/langy-cli-tool-envelope.feature
 */
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

export interface LangyFeatureMapSource {
  id: string;
  name: string;
  children?: LangyFeatureMapSource[];
  surfaces?: { code?: { cli?: string[] | null } | null } | null;
  produces?: string[];
  consumes?: string[];
}

const nullableCliSurfaceSchema = z
  .object({
    cli: z.array(z.string()).nullable().optional(),
  })
  .nullable()
  .optional();

const nullableCodeSurfaceSchema = z
  .object({
    code: nullableCliSurfaceSchema,
  })
  .nullable()
  .optional();

const langyFeatureMapSourceSchema: z.ZodType<LangyFeatureMapSource> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    children: z.array(langyFeatureMapSourceSchema).optional(),
    surfaces: nullableCodeSurfaceSchema,
    produces: z.array(z.string()).optional(),
    consumes: z.array(z.string()).optional(),
  }),
);

const langyFeatureMapSchema = z.object({
  features: z.array(langyFeatureMapSourceSchema),
});

export interface LangyFeatureMap {
  FEATURES: FeatureNode[];
  featureForCliCommand(input: CliCommand): FeatureNode | undefined;
  featureForCliToolName(name: string): FeatureNode | undefined;
  featuresConsuming(kind: string): FeatureNode[];
}

interface RawFeature extends LangyFeatureMapSource {
  children?: RawFeature[];
}

function flatten(features: RawFeature[]): RawFeature[] {
  return features.flatMap((feature) => [feature, ...flatten(feature.children ?? [])]);
}

/**
 * The `<resource> <verb>` pair a CLI command starts with. Deeper commands
 * (`dataset records list`, `prompt tag create`) collapse onto their first two
 * words, which is exactly the key the CLI envelope produces for them.
 */
function commandKey(command: string): string | null {
  const [resource, verb] = command.trim().split(/\s+/);
  return resource && verb ? `${resource}.${verb}` : null;
}

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

export function createLangyFeatureMap(source: unknown): LangyFeatureMap {
  const parsed = langyFeatureMapSchema.parse(source);
  const FEATURES: FeatureNode[] = flatten(parsed.features).map((feature) => ({
    id: feature.id,
    name: feature.name,
    produces: feature.produces ?? [],
    consumes: feature.consumes ?? [],
    cli: feature.surfaces?.code?.cli ?? [],
  }));

  const featureByCommand = new Map<string, FeatureNode>();
  for (const feature of FEATURES) {
    for (const command of feature.cli) {
      const key = commandKey(command);
      if (key && !featureByCommand.has(key)) {
        featureByCommand.set(key, feature);
      }
    }
  }

  const featureForCliCommand = ({ resource, verb }: CliCommand) =>
    featureByCommand.get(`${resource}.${verb}`);

  return {
    FEATURES,
    featureForCliCommand,
    featureForCliToolName(name) {
      const command = parseCliToolName(name);
      return command ? featureForCliCommand(command) : undefined;
    },
    featuresConsuming(kind) {
      return FEATURES.filter((feature) => feature.consumes.includes(kind));
    },
  };
}
