import type { UnknownTraceFilterFieldHint } from "@langwatch/trace-contract";

/**
 * What an unknown trace filter field most likely meant, so a caller that guessed a name learns
 * the one the language has. Spec: specs/traces/trace-filter-api.feature.
 */

/** Names for the trace's text: no field holds it, free text searches it. */
const TEXT_GUESSES = new Set([
  "input",
  "output",
  "text",
  "content",
  "message",
  "messages",
  "question",
  "answer",
  "query",
  "response",
]);

/** Guesses that name a field the language has under another name. */
const RENAMED: Readonly<Record<string, string>> = {
  labels: "label",
  tag: "label",
  tags: "label",
  user_id: "user",
  userid: "user",
  thread_id: "conversation",
  conversation_id: "conversation",
  customer_id: "customer",
  trace_id: "traceId",
  span_id: "spanId",
  error: "errorMessage",
  name: "traceName",
};

const PREFIXES = ["metadata.", "trace.", "attributes.", "@"];

function withoutPrefixes(field: string): string {
  let name = field.toLowerCase();
  for (const prefix of PREFIXES) if (name.startsWith(prefix)) name = name.slice(prefix.length);
  return name;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** The known fields close enough in spelling to be a typo, closest first. */
function fieldsSpelledLike(name: string, knownFields: readonly string[]): string[] {
  return knownFields
    .map((field) => ({ field, distance: editDistance(name, field.toLowerCase()) }))
    .filter(({ distance }) => distance <= 2)
    .toSorted((a, b) => a.distance - b.distance)
    .map(({ field }) => field);
}

/** Points an unknown field at the field or the free-text search the language has. */
export function hintForUnknownTraceFilterField({
  field,
  knownFields,
}: {
  field: string;
  knownFields: readonly string[];
}): UnknownTraceFilterFieldHint {
  const name = withoutPrefixes(field);
  if (TEXT_GUESSES.has(name)) {
    return {
      kind: "hint",
      text: 'No field holds the trace input or output: search its text with a quoted phrase and no field, such as "state of emergency", or with -q.',
    };
  }
  const renamed = RENAMED[name];
  if (renamed && knownFields.includes(renamed)) {
    return { kind: "hint", text: `Did you mean @${renamed}?` };
  }
  const [closest] = fieldsSpelledLike(name, knownFields);
  return closest ? { kind: "hint", text: `Did you mean @${closest}?` } : { kind: "none" };
}
