/**
 * The schema hash of a read: stable for one shape, different for another.
 * Spec: specs/ui/browser-query-caching.feature.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { schemaHashesOf } from "../schema-hash.ts";
import { defineTrpcContract } from "../trpc-contract.ts";

const hashOf = (output: z.ZodType, options: { revision?: number } = {}) =>
  schemaHashesOf(
    defineTrpcContract("organization")
      .query("get", options)
      .withInput(z.object({ id: z.string() }))
      .withOutput(output)
      .mutation("rename")
      .withInput(z.object({ id: z.string() }))
      .withOutput(output)
      .build(),
  );

describe("given a contract's reads", () => {
  /** @scenario "A read's schema hash follows its shape and its revision" */
  it("hashes the same schemas to the same value, whatever the field order", () => {
    const first = hashOf(z.object({ id: z.string(), name: z.string() }));
    const again = hashOf(z.object({ name: z.string(), id: z.string() }));

    expect(first["organization.get"]).toMatch(/^[0-9a-f]{14}$/);
    expect(again).toEqual(first);
  });

  /** @scenario "A read's schema hash follows its shape and its revision" */
  it("hashes a changed field to another value", () => {
    const before = hashOf(z.object({ id: z.string() }));

    expect(hashOf(z.object({ id: z.string(), name: z.string() }))).not.toEqual(before);
    expect(hashOf(z.object({ id: z.number() }))).not.toEqual(before);
  });

  /** @scenario "A read's schema hash follows its shape and its revision" */
  it("hashes a bumped revision to another value", () => {
    const output = z.object({ id: z.string() });

    expect(hashOf(output, { revision: 1 })).not.toEqual(hashOf(output));
    expect(hashOf(output, { revision: 1 })).toEqual(hashOf(output, { revision: 1 }));
  });

  it("names queries only, by their wire path", () => {
    expect(Object.keys(hashOf(z.object({ id: z.string() })))).toEqual(["organization.get"]);
  });
});
