import { generate } from "@langwatch/ksuid";
import type { PromptScope, PromptTag, SchemaVersion } from "@langwatch/prompt-contract";
import { SchemaVersion as SchemaVersions, getVersionValidator } from "@langwatch/prompt-contract";
import { nowInstant, toDate, type TimeInput } from "@langwatch/time";

import type { PromptTagAssignmentRow } from "../prompt-tag-assignment.repository.ts";
import type { PromptVersionAuthor, PromptVersionRow } from "../prompt-version.repository.ts";
import type { PromptConfigRow } from "../prompt.repository.ts";

export type StoredConfig = PromptConfigRow;
export type StoredVersion = PromptVersionRow & { author: PromptVersionAuthor | null };
export type StoredAssignment = PromptTagAssignmentRow & { promptTag: PromptTag };
export type StoredTag = PromptTag & { updatedAt: TimeInput };

/** One installation's owned Prompt state, shared only by its repository bundle. */
export class MemoryPromptState {
  readonly configs = new Map<string, StoredConfig>();
  readonly versions = new Map<string, StoredVersion>();
  readonly tags = new Map<string, StoredTag>();
  readonly assignments = new Map<string, StoredAssignment>();
}

export function clone<Value>(value: Value): Value {
  return structuredClone(value);
}

export function schemaVersionOf(value: string): SchemaVersion {
  for (const schemaVersion of Object.values(SchemaVersions)) {
    if (schemaVersion === value) return schemaVersion;
  }
  throw new Error(`Unsupported prompt schema version: ${value}`);
}

/** A config's versions, newest first. */
export function findVersions(
  state: MemoryPromptState,
  configId: string,
  projectId: string,
): StoredVersion[] {
  return [...state.versions.values()]
    .filter((row) => row.configId === configId && row.projectId === projectId)
    .toSorted((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
}

export function storedHandle(params: {
  handle: string;
  scope: PromptScope;
  projectId: string;
  organizationId: string;
}): string {
  return params.scope === "ORGANIZATION"
    ? `${params.organizationId}/${params.handle}`
    : `${params.projectId}/${params.handle}`;
}

export function visibleConfig(
  config: StoredConfig,
  params: { projectId: string; organizationId: string },
): boolean {
  return (
    config.projectId === params.projectId ||
    (config.organizationId === params.organizationId && config.scope === "ORGANIZATION")
  );
}

export function deriveDisplayHandle(
  config: StoredConfig,
  projectId: string,
  organizationId: string,
): string | null {
  if (!config.handle) return null;
  if (config.handle.startsWith(`${projectId}/`)) return config.handle.slice(projectId.length + 1);
  if (config.handle.startsWith(`${organizationId}/`)) {
    return config.handle.slice(organizationId.length + 1);
  }
  return config.handle;
}

/** Writes one version row and touches its config, as Prisma's insert does. */
export function appendVersion({
  state,
  input,
}: {
  state: MemoryPromptState;
  input: Omit<StoredVersion, "id" | "createdAt" | "author" | "schemaVersion"> & {
    schemaVersion: SchemaVersion;
  };
}): StoredVersion {
  getVersionValidator(input.schemaVersion)
    .omit({ id: true, createdAt: true, version: true })
    .parse(input);
  const row: StoredVersion = {
    ...clone(input),
    id: generate("promptversion").toString(),
    createdAt: toDate(nowInstant()),
    author: null,
  };
  state.versions.set(row.id, row);
  const config = state.configs.get(row.configId);
  if (config) state.configs.set(config.id, { ...config, updatedAt: toDate(nowInstant()) });
  return row;
}
