import { z as z3 } from "zod";
import { fromError, fromZodError } from "zod-validation-error";

// Does fromError produce byte-identical copy to fromZodError for a v3 error?
// The two routes previously returned fromZodError(...).message verbatim, so a
// difference here is a customer-visible API response change.
const cases = [
  [z3.object({ trace_id: z3.string(), metrics: z3.object({}) }), {}],
  [z3.object({ a: z3.number().min(5) }), { a: 1 }],
  [z3.union([z3.object({ k: z3.literal("x") }), z3.object({ k: z3.literal("y") })]), { k: "z" }],
  [z3.object({ nested: z3.object({ deep: z3.string() }) }), { nested: {} }],
];

let identical = true;
for (const [schema, value] of cases) {
  try {
    schema.parse(value);
  } catch (e) {
    const a = fromZodError(e).message;
    const b = fromError(e).message;
    if (a !== b) {
      identical = false;
      console.log("DIFF:\n  fromZodError:", a, "\n  fromError:   ", b);
    }
  }
}
console.log(identical ? "IDENTICAL for all v3 cases" : "MESSAGES DIFFER");
