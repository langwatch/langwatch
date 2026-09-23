// Target identity: agent plus its parameter overrides.

import type {
  RunParameterValues,
  ScenarioParameterDefinition,
  ScenarioParameterValue,
} from "@langwatch/scenario-contract";

/** How many hex characters of the hash a key keeps. */
export const TARGET_KEY_HASH_LENGTH = 8;

/** What sits between a reference id and its hash inside a key. */
const HASH_SEPARATOR = "#";

/** What sits between a target's name and its parameters in a label. */
export const TARGET_LABEL_SEPARATOR = " · ";

const HASH_PATTERN = /^[0-9a-f]{8}$/;

/** True when the target carries at least one parameter override. */
export function hasParameterOverrides(
  runParameters: RunParameterValues | undefined,
): runParameters is RunParameterValues {
  return runParameters !== undefined && Object.keys(runParameters).length > 0;
}

/** What a declared parameter says about its default, as the rule reads it. */
type DeclaredParameter = Pick<ScenarioParameterDefinition, "name" | "defaultValue" | "secret">;

/**
 * The default of every plain parameter the scenarios of a run declare.
 * First declaration wins, as the run dialog unions definitions — two
 * scenarios defaulting one name differently read one default. Secrets never appear.
 */
export function declaredDefaults(
  definitions: readonly DeclaredParameter[],
): Map<string, ScenarioParameterValue> {
  const defaults = new Map<string, ScenarioParameterValue>();
  for (const definition of definitions) {
    if (definition.secret === true || definition.defaultValue === undefined) continue;
    if (!defaults.has(definition.name)) defaults.set(definition.name, definition.defaultValue);
  }
  return defaults;
}

/**
 * The overrides of a target: given values with every entry equal to the
 * declared default removed — such a value changes nothing the agent
 * receives, so a blank row and one spelling out the default are one target.
 */
export function canonicalOverrides({
  runParameters,
  defaults,
}: {
  runParameters?: RunParameterValues;
  defaults: ReadonlyMap<string, ScenarioParameterValue>;
}): RunParameterValues | undefined {
  if (!hasParameterOverrides(runParameters)) return undefined;
  const kept = Object.entries(runParameters).filter(
    ([name, value]) => defaults.get(name) !== value,
  );
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

/** The targets with their overrides canonical, the key absent when empty. */
export function withCanonicalOverrides<T extends { runParameters?: RunParameterValues }>({
  targets,
  defaults,
}: {
  targets: readonly T[];
  defaults: ReadonlyMap<string, ScenarioParameterValue>;
}): T[] {
  return targets.map((target) => {
    const { runParameters: _given, ...rest } = target;
    const runParameters = canonicalOverrides({
      runParameters: target.runParameters,
      defaults,
    });
    return (runParameters ? { ...rest, runParameters } : rest) as T;
  });
}

/** The overrides as one comparable string: JSON, keys sorted by code point. */
export function canonicalParameters(runParameters: RunParameterValues): string {
  return JSON.stringify(Object.fromEntries(sortedEntries(runParameters)));
}

/**
 * The key a target folds under: the reference id alone with no overrides
 * (unchanged from before overrides existed), else id + `#` + the first
 * eight hex SHA-1 chars of the canonical overrides — order-independent.
 */
export function targetKeyOf({
  referenceId,
  runParameters,
}: {
  referenceId: string;
  runParameters?: RunParameterValues;
}): string {
  if (!hasParameterOverrides(runParameters)) return referenceId;
  const hash = sha1Hex(canonicalParameters(runParameters)).slice(0, TARGET_KEY_HASH_LENGTH);
  return `${referenceId}${HASH_SEPARATOR}${hash}`;
}

/**
 * A key back into its reference id and its hash — null hash for a key with
 * no overrides. A `#` not followed by a hash of the right shape is part
 * of the reference id.
 */
export function splitTargetKey(key: string): {
  referenceId: string;
  hash: string | null;
} {
  const at = key.lastIndexOf(HASH_SEPARATOR);
  if (at < 0) return { referenceId: key, hash: null };
  const hash = key.slice(at + 1);
  if (!HASH_PATTERN.test(hash)) return { referenceId: key, hash: null };
  return { referenceId: key.slice(0, at), hash };
}

/**
 * The overrides as `k=v, k=v`, keys sorted. Empty when there are none.
 *
 * With `names`, only the pairs of those names are read.
 */
export function targetParametersLabel({
  runParameters,
  names,
}: {
  runParameters: RunParameterValues | undefined;
  names?: ReadonlySet<string>;
}): string {
  return parameterPairs({ runParameters, names }).join(", ");
}

/**
 * The string a target sorts under: `type:referenceId|k=v,k2=v2`, overrides
 * sorted by name. Readable on purpose — the run dialog and server both sort
 * by it, keeping run columns in the dialog's order. The hash is {@link targetKeyOf} alone.
 */
export function targetSortKey({
  type,
  referenceId,
  runParameters,
}: {
  type: string;
  referenceId: string;
  runParameters?: RunParameterValues;
}): string {
  return `${type}:${referenceId}|${parameterPairs({ runParameters }).join(",")}`;
}

// Target identity as canonical JSON (not comma-separated pairs).
export function targetIdentityKey({
  type,
  referenceId,
  runParameters,
}: {
  type: string;
  referenceId: string;
  runParameters?: RunParameterValues;
}): string {
  return JSON.stringify([
    type,
    referenceId,
    hasParameterOverrides(runParameters) ? canonicalParameters(runParameters) : "",
  ]);
}

/** The overrides as `k=v` pairs, sorted by name, kept to `names` when given. */
function parameterPairs({
  runParameters,
  names,
}: {
  runParameters: RunParameterValues | undefined;
  names?: ReadonlySet<string>;
}): string[] {
  if (!hasParameterOverrides(runParameters)) return [];
  return sortedEntries(runParameters)
    .filter(([name]) => names === undefined || names.has(name))
    .map(([name, value]) => `${name}=${value}`);
}

/** A target as the label rules read it: its agent and its overrides. */
type LabelledTarget = {
  referenceId: string;
  runParameters?: RunParameterValues;
};

/**
 * The parameter names telling one agent's targets apart: for an agent
 * appearing more than once, names whose value differs across its targets
 * (presence counts as a difference too). An agent appearing once has none.
 */
export function differingParameterNames(
  targets: readonly LabelledTarget[],
): Map<string, Set<string>> {
  const setsByAgent = new Map<string, RunParameterValues[]>();
  for (const target of targets) {
    const sets = setsByAgent.get(target.referenceId) ?? [];
    sets.push(target.runParameters ?? {});
    setsByAgent.set(target.referenceId, sets);
  }
  return new Map(
    [...setsByAgent].map(([referenceId, sets]) => [referenceId, namesThatDiffer(sets)]),
  );
}

/** The names whose value is not the same on every one of the sets. */
function namesThatDiffer(sets: readonly RunParameterValues[]): Set<string> {
  const names = new Set<string>();
  if (sets.length < 2) return names;
  for (const name of new Set(sets.flatMap((set) => Object.keys(set)))) {
    const values = new Set(sets.map((set) => JSON.stringify(set[name])));
    if (values.size > 1) names.add(name);
  }
  return names;
}

// Target label: name, parameters, environment, or owner name as applicable.
export function targetLabelOf({
  name,
  environment,
  ownerName,
  runParameters,
  differingNames,
}: {
  name: string;
  /** The environment of a connected agent; nothing for any other target. */
  environment?: string | null;
  /** The owner's display name of a personal connected agent. */
  ownerName?: string | null;
  runParameters?: RunParameterValues;
  differingNames: ReadonlySet<string>;
}): string {
  const parameters = targetParametersLabel({
    runParameters,
    names: differingNames,
  });
  const agent = environment
    ? `${name}${TARGET_LABEL_SEPARATOR}${environment}${ownerName ? ` (${ownerName})` : ""}`
    : name;
  return parameters === "" ? agent : `${agent}${TARGET_LABEL_SEPARATOR}${parameters}`;
}

// Labels for a list of targets, applying the shared run naming rule.
export function targetLabels<T extends LabelledTarget>({
  targets,
  nameOf,
  environmentOf,
  ownerNameOf,
}: {
  targets: readonly T[];
  nameOf: (target: T) => string;
  /** The environment of a connected agent target; nothing for the rest. */
  environmentOf?: (target: T) => string | null | undefined;
  /** The owner's display name of a personal connected agent target. */
  ownerNameOf?: (target: T) => string | null | undefined;
}): string[] {
  const differing = differingParameterNames(targets);
  return targets.map((target) =>
    targetLabelOf({
      name: nameOf(target),
      environment: environmentOf?.(target),
      ownerName: ownerNameOf?.(target),
      runParameters: target.runParameters,
      differingNames: differing.get(target.referenceId) ?? new Set(),
    }),
  );
}

function sortedEntries(runParameters: RunParameterValues): [string, RunParameterValues[string]][] {
  return Object.entries(runParameters).toSorted(([left], [right]) => compareKeys(left, right));
}

function compareKeys(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

const rotateLeft = (value: number, bits: number): number =>
  ((value << bits) | (value >>> (32 - bits))) >>> 0;

/** The message padded to whole 64-byte blocks, its bit length at the end. */
function padMessage(text: string): DataView {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  return view;
}

/** The 80 message words of one block. */
function scheduleWords(view: DataView, offset: number): Uint32Array {
  const words = new Uint32Array(80);
  for (let i = 0; i < 16; i++) {
    words[i] = view.getUint32(offset + i * 4);
  }
  for (let i = 16; i < 80; i++) {
    words[i] = rotateLeft(
      (words[i - 3]! ^ words[i - 8]! ^ words[i - 14]! ^ words[i - 16]!) >>> 0,
      1,
    );
  }
  return words;
}

/** The mixing function and the constant of round `i`. */
function roundTerms(
  i: number,
  { b, c, d }: { b: number; c: number; d: number },
): [f: number, k: number] {
  if (i < 20) return [(b & c) | (~b & d), 0x5a827999];
  if (i < 40) return [b ^ c ^ d, 0x6ed9eba1];
  if (i < 60) return [(b & c) | (b & d) | (c & d), 0x8f1bbcdc];
  return [b ^ c ^ d, 0xca62c1d6];
}

/** One block folded into the running state. */
function compressBlock(state: number[], words: Uint32Array): void {
  let [a, b, c, d, e] = state as [number, number, number, number, number];
  for (let i = 0; i < 80; i++) {
    const [f, k] = roundTerms(i, { b, c, d });
    const next = (rotateLeft(a, 5) + (f >>> 0) + e + k + words[i]!) >>> 0;
    e = d;
    d = c;
    c = rotateLeft(b, 30);
    b = a;
    a = next;
  }
  state[0] = (state[0]! + a) >>> 0;
  state[1] = (state[1]! + b) >>> 0;
  state[2] = (state[2]! + c) >>> 0;
  state[3] = (state[3]! + d) >>> 0;
  state[4] = (state[4]! + e) >>> 0;
}

/** SHA-1 of a string, as 40 hex characters. */
function sha1Hex(text: string): string {
  const view = padMessage(text);
  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  for (let offset = 0; offset < view.byteLength; offset += 64) {
    compressBlock(state, scheduleWords(view, offset));
  }
  return state.map((word) => word.toString(16).padStart(8, "0")).join("");
}
