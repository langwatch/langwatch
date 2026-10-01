/**
 * "Acme is already here — join instead?" (D12): the organizations open to the
 * reader's own verified address, read off the join lookup the wire carries as
 * `unknown`. Only the names are read; anything else answers nothing.
 */
import { z } from "zod";

const namedSchema = z.object({ name: z.string() });

const lookupSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("none") }),
  z.object({ outcome: z.literal("ask"), organizations: z.array(namedSchema) }),
  z.object({ outcome: z.literal("auto"), organization: namedSchema }),
]);

/** An automatic match answers the same way: it is still somewhere to go. */
export function extractJoinInsteadNames(lookup: unknown): string[] {
  const parsed = lookupSchema.safeParse(lookup);
  if (!parsed.success) return [];
  const decision = parsed.data;
  if (decision.outcome === "none") return [];
  if (decision.outcome === "auto") return [decision.organization.name];
  return decision.organizations.map((organization) => organization.name);
}

/** "Acme", "Acme and Beta", "Acme, Beta and Gamma" — never a count. */
export function formatJoinInsteadNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
