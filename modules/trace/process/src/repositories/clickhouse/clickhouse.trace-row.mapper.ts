import { z } from "zod";

const NUMERIC = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

/** A numeric column; ClickHouse's JSON writes 64-bit integers as strings. */
export const chNumber = z.union([z.number(), z.string().regex(NUMERIC).transform(Number)]);

/** A string column, read as a string even where ClickHouse wrote a number. */
export const chString = z.union([z.string(), z.number().transform(String)]);

/** A flag column read as a boolean: Bool arrives as true/false, UInt8 as 0/1. */
export const chBoolean = z
  .union([z.boolean(), z.number(), z.string()])
  .transform((value) => value === true || value === 1 || value === "1" || value === "true");

/** A flag column read as the 0/1 number the row type states. */
export const chFlag = chBoolean.transform((value) => (value ? 1 : 0));

/** A Map(String, String) column, which ClickHouse writes as a JSON object. */
export const chStringMap = z.record(z.string(), z.string());
