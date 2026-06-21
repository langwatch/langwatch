/**
 * Static markdown describing the trace query language, fed to the LLM that
 * powers AI mode. (The in-app docs drawer renders its own JSX from
 * `SEARCH_FIELDS` / `FIELD_VALUES`, so it doesn't consume this string.)
 */
export const QUERY_SYNTAX_DOC = `# Trace query syntax

A small Lucene-flavoured language for filtering traces. Every clause is a
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

Two open-ended namespaces let you query arbitrary OTel attributes without
adding them to the static fields table:

| Form | Matches | Example |
| --- | --- | --- |
| \`attribute.<key>:value\` | trace-level attribute equality (\`Attributes[key]\`) | \`attribute.langwatch.user_id:alice\` |
| \`event.<key>:value\` | per-event attribute across every span event in the trace | \`event.exception.type:TimeoutError\` |
| \`event:<name>\` | bare event-name filter (no dot in the field) | \`event:tool_call\` |
| \`has:attribute.<key>\` | trace has *any* value at \`Attributes[key]\` | \`has:attribute.gen_ai.conversation.id\` |
| \`none:attribute.<key>\` | trace has no value at \`Attributes[key]\` | \`none:attribute.langwatch.user_id\` |

The dot is the disambiguator — \`event:foo\` matches an event *name*, and
\`event.foo:bar\` matches an event *attribute*. Same shape applies on the
trace side via \`attribute.foo:bar\`.

## Limitations & gotchas

- Operators must be uppercase. \`status:error and model:gpt-4o\` is **invalid** — write \`AND\`.
- A trailing colon with no value (\`status:\`) is a syntax error. Provide a value or remove the clause.
- Mixing \`OR\` across different fields (\`status:error OR model:gpt-4o\`) works but bypasses the sidebar facets — prefer staying within one field per \`OR\` chain.
- Attribute matching is exact equality only — wildcards (\`attribute.foo:*ar\`) and ranges (\`attribute.tokens:>10\`) aren't yet supported on the dynamic namespaces.
`;
