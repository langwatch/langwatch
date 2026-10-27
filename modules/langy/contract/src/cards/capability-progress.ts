/**
 * The wording of a capability call, shared by the panel's cards and the relay's
 * running sub-status ("Searching traces") so the two can never drift.
 * @see specs/langy/langy-plan-progress.feature
 */
import { CAPABILITY_CATALOG, type CapabilityCatalogEntry } from "./capability-catalog.ts";
import { CLI_COLLECTION_VERBS } from "./registry.ts";

/** A `langwatch <resource> <verb>` invocation, as the CLI envelope decodes it. */
export interface CliCommand {
  resource: string;
  verb: string;
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

/**
 * How a CLI verb READS, in both tenses. `past` titles a SETTLED write card ("New
 * evaluator", "Delete trigger"); `present` titles a RUNNING one ("Creating evaluator").
 */
export const CAPABILITY_VERB_WORDING: Readonly<Record<string, { past: string; present: string }>> =
  {
    search: { past: "", present: "Searching" },
    query: { past: "", present: "Searching" },
    list: { past: "", present: "Listing" },
    versions: { past: "", present: "Listing" },
    "list-runs": { past: "", present: "Listing" },
    records: { past: "", present: "Listing" },
    get: { past: "", present: "Loading" },
    show: { past: "", present: "Loading" },
    view: { past: "", present: "Loading" },
    status: { past: "", present: "Checking" },
    health: { past: "", present: "Checking" },
    results: { past: "", present: "Loading" },
    tail: { past: "", present: "Loading" },
    export: { past: "", present: "Exporting" },
    download: { past: "", present: "Downloading" },
    create: { past: "New", present: "Creating" },
    init: { past: "New", present: "Creating" },
    add: { past: "Add to", present: "Adding to" },
    upload: { past: "Upload to", present: "Uploading to" },
    update: { past: "Update", present: "Updating" },
    set: { past: "Set", present: "Updating" },
    unset: { past: "Reset", present: "Updating" },
    rotate: { past: "Rotate", present: "Rotating" },
    rename: { past: "Rename", present: "Updating" },
    assign: { past: "Assign", present: "Updating" },
    restore: { past: "Restore", present: "Restoring" },
    sync: { past: "Sync", present: "Syncing" },
    push: { past: "Push", present: "Pushing" },
    pull: { past: "Pull", present: "Pulling" },
    duplicate: { past: "Duplicate", present: "Duplicating" },
    delete: { past: "Delete", present: "Deleting" },
    remove: { past: "Delete", present: "Deleting" },
    archive: { past: "Delete", present: "Deleting" },
    revoke: { past: "Delete", present: "Deleting" },
    run: { past: "Run", present: "Running" },
  };

/** The catalog read by any resource word, so an unknown one reads as absent. */
const CATALOG_ROWS: Readonly<Record<string, CapabilityCatalogEntry | undefined>> =
  CAPABILITY_CATALOG;

/**
 * What a resource is called in customer words: the catalog's row, or for a
 * resource the catalog has never heard of (version skew) the command's own word
 * humanised as-is, `virtual-keys` → "virtual keys".
 */
export function capabilityNoun(resource: string): { singular: string; plural: string } {
  const entry = CATALOG_ROWS[resource];
  if (entry) return entry.noun;
  const singular = resource.replace(/[_-]/g, " ").trim();
  const plural = singular.endsWith("s") ? singular : `${singular}s`;
  return { singular, plural };
}

/** A running call's wording, or `none` for a call that is not a LangWatch CLI capability. */
export type CapabilityProgressWording =
  | { outcome: "worded"; headline: string }
  | { outcome: "none" };

/** A RUNNING capability call's present-tense headline, e.g. "Searching traces". */
export function wordCapabilityProgress(rawName: string): CapabilityProgressWording {
  const command = parseCliToolName(rawName);
  if (!command) return { outcome: "none" };
  const noun = capabilityNoun(command.resource);
  const verb = CAPABILITY_VERB_WORDING[command.verb]?.present ?? "Working on";
  const headline = `${verb} ${CLI_COLLECTION_VERBS.has(command.verb) ? noun.plural : noun.singular}`;
  return { outcome: "worded", headline };
}
