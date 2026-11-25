/**
 * A read's schema hash: a stable digest of its input and output schemas and its `revision`,
 * taken from the contract on the server and in the browser alike.
 * Spec: specs/ui/browser-query-caching.feature.
 */

import { z } from "zod";

import type { TrpcContract, TrpcContractMember } from "./trpc-contract.ts";

/** The header the server answers every query with; the browser compares it with its own hash. */
export const SCHEMA_HASH_HEADER = "x-lw-schema";

const hashes = new WeakMap<TrpcContractMember, string>();
const maps = new WeakMap<TrpcContract, Readonly<Record<string, string>>>();

/** JSON with keys and string lists (`required`, `enum`) sorted: declaration order never counts. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    const items = value.every((item) => typeof item === "string") ? value.toSorted() : value;

    return `[${items.map(canonical).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).toSorted(([a], [b]) => (a < b ? -1 : 1));

    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}

/** cyrb53: 53 bits, no Node API, the same digest in a browser and on the server. */
function digest(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** The hash of one declared procedure's input, output and revision. */
export function schemaHashOf(member: TrpcContractMember): string {
  const known = hashes.get(member);
  if (known) return known;

  const json = (schema: z.ZodType, io: "input" | "output") =>
    z.toJSONSchema(schema, { unrepresentable: "any", io });
  const hash = digest(
    canonical({
      input: json(member.input, "input"),
      output: member.output ? json(member.output, "output") : null,
      revision: member.revision ?? 0,
    }),
  );
  hashes.set(member, hash);

  return hash;
}

/** Every query of a contract, by wire path `namespace.name`; mutations and streams have none. */
export function schemaHashesOf(contract: TrpcContract): Readonly<Record<string, string>> {
  const known = maps.get(contract);
  if (known) return known;

  const hashed = Object.fromEntries(
    Object.entries(contract.members)
      .filter(([, member]) => member.kind === "query")
      .map(([name, member]) => [`${contract.namespace}.${name}`, schemaHashOf(member)]),
  );
  maps.set(contract, hashed);

  return hashed;
}
