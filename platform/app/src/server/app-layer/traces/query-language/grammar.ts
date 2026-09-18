/**
 * Static markdown describing the trace query language.
 *
 * Two readers, both of them models: the LLM behind the Trace Explorer's AI
 * mode, and the query reference this document is published in
 * (`~/server/analytics/query-reference`). The in-app docs drawer renders its
 * own JSX from `SEARCH_FIELDS` / `FIELD_VALUES`, so it does not consume this
 * string.
 *
 * The attribute section names the prefixes {@link DYNAMIC_PREFIXES} publishes
 * and the translator dispatches on — `trace.attribute.`, `span.attribute.`,
 * `event.attribute.` — with the older spellings listed as still accepted. It
 * documented only the older ones for a while, which is the worst arrangement of
 * the three: a model reading it wrote `attribute.foo:bar` where the
 * autocomplete, the saved views and the span namespace all say
 * `trace.attribute.foo:bar`, and the span namespace has no older spelling to
 * fall back on, so `span.attribute.` was simply undiscoverable.
 */
export const QUERY_SYNTAX_DOC = `# Trace query syntax

A small Lucene-flavored language for filtering traces. Every clause is a
\`field:value\` pair joined by boolean operators. Free text without a field
matches against trace input/output.

## Quick start

| Goal | Query |
| --- | --- |
| Failing traces | \`status:error\` |
| Failing OpenAI traces | \`status:error AND model:gpt-*\` |
| Either failing or warning | \`status:error OR status:warning\` |
| Slow and expensive | \`duration:>5000 AND cost:>0.10\` |
| Mention of "refund" anywhere | \`refund\` |

## Grammar

\`\`\`
query     = clause ( WS boolean WS clause )*
clause    = [NOT WS] (term | "(" query ")")
term      = field ":" value | freeText
boolean   = "AND" | "OR"
field     = identifier
value     = exact | wildcard | comparison | range | quoted
exact     = literal
wildcard  = literal containing "*"
comparison= (">" | ">=" | "<" | "<=") number
range     = "[" number "TO" number "]"
quoted    = "\\"" anything "\\""
freeText  = literal | quoted
\`\`\`

- Operators (\`AND\`, \`OR\`, \`NOT\`) are case-sensitive and **must be uppercase**.
- \`NOT\` and the shorthand \`-\` both negate the next clause.
- Parentheses group clauses: \`(status:error OR status:warning) AND model:gpt-4o\`.
- A bare token like \`refund\` searches free text — no field prefix required.

## Operators

| Operator | Meaning | Example |
| --- | --- | --- |
| \`AND\` | both must match | \`status:error AND model:gpt-4o\` |
| \`OR\` | either may match | \`origin:simulation OR origin:evaluation\` |
| \`NOT\` / \`-\` | negate next clause | \`NOT status:ok\` · \`-status:ok\` |
| \`( … )\` | grouping | \`(status:error OR status:warning) AND service:web\` |

## Value forms

| Form | Example | Notes |
| --- | --- | --- |
| Exact match | \`model:gpt-4o\` | Case-insensitive for categorical fields. |
| Wildcard | \`model:gpt-*\` | \`*\` matches any characters. |
| Comparison | \`cost:>0.05\` · \`duration:<=1000\` | Numeric / range fields only. |
| Range | \`cost:[0.01 TO 1.00]\` | Inclusive on both ends. |
| Quoted | \`user:"alice@example.com"\` | Required if the value contains spaces or special characters. |
| Free text | \`refund\` · \`"refund policy"\` | Searches trace input/output. |

## Attributes

Three open-ended namespaces let you query arbitrary OTel attributes without
adding them to the static fields table. One per place an attribute can live:

| Form | Matches | Example |
| --- | --- | --- |
| \`trace.attribute.<key>:value\` | trace-level attribute equality (\`Attributes[key]\`) | \`trace.attribute.langwatch.user_id:alice\` |
| \`span.attribute.<key>:value\` | per-span attribute across every span in the trace (\`SpanAttributes[key]\`) | \`span.attribute.gen_ai.request.model:gpt-5-mini\` |
| \`event.attribute.<key>:value\` | per-event attribute across every span event in the trace | \`event.attribute.exception.type:TimeoutError\` |
| \`event:<name>\` | bare event-name filter (no dot in the field) | \`event:tool_call\` |
| \`has:trace.attribute.<key>\` | trace has *any* value at \`Attributes[key]\` | \`has:trace.attribute.gen_ai.conversation.id\` |
| \`none:trace.attribute.<key>\` | trace has no value at \`Attributes[key]\` | \`none:trace.attribute.langwatch.user_id\` |

Write the namespaced prefixes above. Two older spellings are still accepted so
saved views and older scripts keep working: \`attribute.<key>\` means
\`trace.attribute.<key>\`, and \`event.<key>\` means \`event.attribute.<key>\`.
There is no older spelling for the span namespace.

The dot is the disambiguator — \`event:foo\` matches an event *name*, and
\`event.attribute.foo:bar\` matches an event *attribute*.

## Limitations & gotchas

- Operators must be uppercase. \`status:error and model:gpt-4o\` is **invalid** — write \`AND\`.
- A trailing colon with no value (\`status:\`) is a syntax error. Provide a value or remove the clause.
- Mixing \`OR\` across different fields (\`status:error OR model:gpt-4o\`) works but bypasses the sidebar facets — prefer staying within one field per \`OR\` chain.
- Attribute matching is exact equality only — wildcards (\`trace.attribute.foo:*ar\`) and ranges (\`trace.attribute.tokens:>10\`) aren't yet supported on the dynamic namespaces.
`;
