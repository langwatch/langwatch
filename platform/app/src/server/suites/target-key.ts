/**
 * A target is an agent and its parameters.
 *
 * A run plan may point one agent at itself twice with different parameter
 * overrides, "prod-agent on gpt-5 vs prod-agent on gpt-5-mini". Each of those
 * is its own target, so a target needs an identity wider than its reference
 * id. This module is that identity: the key a target folds under, the way a
 * key splits back apart, and the one label rule the run dialog, the plan name
 * and the results page all read.
 *
 * Framework-free and dependency-free on purpose: the browser bundle imports
 * it, so nothing here may reach for node's crypto, the database or a request.
 * The hash is a small SHA-1 written out below for the same reason.
 *
 * @see specs/suites/run-plan-identity-by-name.feature
 */

import type { RunParameterValues } from "../scenarios/parameters";

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

/** The overrides as one comparable string: JSON, keys sorted by code point. */
export function canonicalParameters(runParameters: RunParameterValues): string {
  return JSON.stringify(Object.fromEntries(sortedEntries(runParameters)));
}

/**
 * The key a target folds under.
 *
 * The reference id alone when the target carries no overrides, so every key
 * that existed before overrides did is unchanged. Otherwise the reference id,
 * `#`, and the first eight hex characters of the SHA-1 of the canonical
 * overrides, so the same overrides written in another order take one key.
 */
export function targetKeyOf({
  referenceId,
  runParameters,
}: {
  referenceId: string;
  runParameters?: RunParameterValues;
}): string {
  if (!hasParameterOverrides(runParameters)) return referenceId;
  const hash = sha1Hex(canonicalParameters(runParameters)).slice(
    0,
    TARGET_KEY_HASH_LENGTH,
  );
  return `${referenceId}${HASH_SEPARATOR}${hash}`;
}

/**
 * A key back into its reference id and its hash.
 *
 * The hash is null for a key with no overrides. A `#` that is not followed by
 * a hash of the right shape is part of the reference id.
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
export function targetParametersLabel(
  runParameters: RunParameterValues | undefined,
  names?: ReadonlySet<string>,
): string {
  return parameterPairs(runParameters, names).join(", ");
}

/**
 * The string a target sorts under: `type:referenceId|k=v,k2=v2`, the
 * overrides sorted by name, nothing after the `|` when there are none.
 *
 * Readable on purpose, and the one string the run dialog and the server both
 * sort by, so the columns of a run keep the order the dialog showed them in.
 * The hash lives in {@link targetKeyOf} alone.
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
  return `${type}:${referenceId}|${parameterPairs(runParameters).join(",")}`;
}

/** The overrides as `k=v` pairs, sorted by name, kept to `names` when given. */
function parameterPairs(
  runParameters: RunParameterValues | undefined,
  names?: ReadonlySet<string>,
): string[] {
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
 * The parameter names that tell the targets of one agent apart.
 *
 * For each agent that appears more than once, the names whose value is not
 * the same on every one of its targets. A name one target carries and another
 * does not counts as a difference. An agent that appears once has no such
 * name, and neither has a name every target of the agent shares.
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
    [...setsByAgent].map(([referenceId, sets]) => [
      referenceId,
      namesThatDiffer(sets),
    ]),
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

/**
 * What a target is called.
 *
 * Its name, or `name · k=v` over the names in `differingNames` the target
 * carries: the parameters that tell it from the other targets of the same
 * agent, and none of the ones they share. A target that carries none of them
 * keeps its bare name.
 */
export function targetLabelOf({
  name,
  runParameters,
  differingNames,
}: {
  name: string;
  runParameters?: RunParameterValues;
  differingNames: ReadonlySet<string>;
}): string {
  const parameters = targetParametersLabel(runParameters, differingNames);
  return parameters === ""
    ? name
    : `${name}${TARGET_LABEL_SEPARATOR}${parameters}`;
}

/**
 * The labels of a list of targets, in the order given.
 *
 * The one rule the run dialog, the plan name and the run detail share: an
 * agent that appears once reads as its name, and an agent that appears more
 * than once reads with the parameters that differ between its targets.
 */
export function targetLabels<T extends LabelledTarget>({
  targets,
  nameOf,
}: {
  targets: readonly T[];
  nameOf: (target: T) => string;
}): string[] {
  const differing = differingParameterNames(targets);
  return targets.map((target) =>
    targetLabelOf({
      name: nameOf(target),
      runParameters: target.runParameters,
      differingNames: differing.get(target.referenceId) ?? new Set(),
    }),
  );
}

function sortedEntries(
  runParameters: RunParameterValues,
): [string, RunParameterValues[string]][] {
  return Object.entries(runParameters).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
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
