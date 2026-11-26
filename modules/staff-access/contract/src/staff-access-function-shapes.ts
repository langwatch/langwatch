import type { Named } from "@langwatch/module";
/**
 * The shapes every ops function entry is built from (ADR-202, amendment 2026-11-25): the
 * scope, page and range inputs, the page output, and the entry itself.
 * Spec: modules/staff-access/specs/staff-access-functions.feature
 */
import { z } from "zod";

export const STAFF_ACCESS_FUNCTION_LIMITS = {
  /** How many functions one request may name. */
  maxPerRequest: 12,
  maxRangeDays: 31,
  defaultPageSize: 50,
  maxPageSize: 200,
} as const;

/** `lookup` finds an id, `platform` spans organizations, `org` reads the approved org. */
export const staffAccessFunctionScopeSchema = z.enum(["lookup", "platform", "org"]);
export type StaffAccessFunctionScope = z.infer<typeof staffAccessFunctionScopeSchema>;

export const isoTime = z.iso.datetime({ offset: true });
export const pageInput = {
  limit: z.number().int().min(1).max(STAFF_ACCESS_FUNCTION_LIMITS.maxPageSize).optional(),
  cursor: z.string().min(1).max(500).optional(),
};
export const rangeInput = {
  /** Start of the range; at most 31 days before `until`. */
  since: isoTime,
  /** End of the range; now when left out. */
  until: isoTime.optional(),
};

/** A page of `item`: never a silent cut, `truncated` says more exist and `nextCursor` reads on. */
export type StaffAccessPageSchema<Item extends z.ZodType> = z.ZodObject<
  {
    items: z.ZodArray<Item>;
    total: z.ZodNumber;
    truncated: z.ZodBoolean;
    nextCursor: z.ZodNullable<z.ZodString>;
  },
  z.core.$strict
>;

export function staffAccessPageSchema<Item extends z.ZodType>(
  item: Item,
): StaffAccessPageSchema<Item> {
  return z
    .object({
      items: z.array(item),
      total: z.number().int(),
      truncated: z.boolean(),
      nextCursor: z.string().nullable(),
    })
    .strict();
}

const countsByCodeDefinition = z.record(z.string(), z.number().int());
export interface CountsByCode extends Named<typeof countsByCodeDefinition> {}
export const countsByCode: CountsByCode = countsByCodeDefinition;

export type StaffAccessFunctionEntry = Readonly<{
  title: string;
  scope: StaffAccessFunctionScope;
  /** The investigation this read answers. */
  answers: string;
  /** Answers about one person, from one exact input. */
  personal?: true;
  input: z.ZodObject;
  output: z.ZodType;
}>;

export const entry = <E extends StaffAccessFunctionEntry>(declared: E): E => declared;
