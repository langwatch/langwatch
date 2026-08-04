# dogfood payloads — IngestionTemplate fixtures

Canned OTLP/HTTP traces payloads consumed by `../emit-otlp.sh` for
per-template dogfood rituals + cross-user isolation regression +
principal-field forge-attempt regression.

## Layout

```
payloads/
├── README.md                            (this file — contract)
├── claude_code.json                     (one per v1 template slug)
├── cursor.json
├── claude_cowork.json
├── raw_otlp_advanced.json               (no-template fallback shape)
└── forge-attempt/
    ├── attribution.json                 (claims B6 16-key attribution keys)
    └── provenance.json                  (claims 5-key provenance: template.id + binding.id + source + origin + organization_id)
```

Each `<slug>.json` is a complete OTLP/HTTP traces request body matching
the **canonical post-OTTL shape** for that template. The wrapper script
overwrites `traceId` / `spanId` per request (so an N>1 burst lands as
distinct traces) and optionally injects `langwatch.tenant_id` for
cross-user isolation testing — payload authors should NOT hard-code
the trace/span IDs to anything load-bearing.

## Payload contract

A canned payload is a JSON document with **at least** this shape:

```json
{
  "resourceSpans": [
    {
      "resource": {
        "attributes": [
          { "key": "service.name", "value": { "stringValue": "..." } }
        ]
      },
      "scopeSpans": [
        {
          "scope": { "name": "..." },
          "spans": [
            {
              "traceId": "<placeholder>",
              "spanId":  "<placeholder>",
              "name":    "...",
              "kind":    1,
              "startTimeUnixNano": "...",
              "endTimeUnixNano":   "...",
              "attributes": [ { "key": "gen_ai.system", "value": { "stringValue": "anthropic" } } ],
              "status":     { "code": 1 }
            }
          ]
        }
      ]
    }
  ]
}
```

The wrapper rewrites `traceId` / `spanId` everywhere they appear, so
authors can use any placeholder values (the canonical pattern is
zero-padded `"00000…"` strings of the right length).

## Per-template payload guidance

Each canned shape should reflect what the template's OTTL transform
will see from a real upstream emitter. The intent is that running
`emit-otlp.sh --template-id <slug>` produces a trace that lands in
`/me/traces` with the same canonical fields populated as a real
upstream run would — `gen_ai.system`, `gen_ai.request.model`,
`gen_ai.usage.input_tokens` / `output_tokens`, plus any
template-specific attrs (`claude.code.session_id`,
`cursor.agent.id`, `claude.cowork.session_id`, etc.).

`raw_otlp_advanced.json` is the no-template-fallback shape: a generic
OTLP span with no template OTTL applied. Used to validate the
`/me/settings → Personal OTLP Endpoint` panel + to anchor the copy
disambiguation between auto-shaped templates and BYO-shape ingest.

## Forge-attempt payloads

`forge-attempt/<category>.json` payloads claim values for **protected**
keys that the template OTTL is **not** permitted to write. The receiver's
`protectedTemplateAttributeKeys` guard re-stamps these post-OTTL with the
binding-authoritative values, and emits a single
`gateway.template_ottl_protected_field_attempt` audit row per attempt
(payload includes the rejected key list).

Two categories cover the v1 closed list:

- `attribution.json` — claims values for the B6 16-key attribution set
  (`langwatch.user.id`, `langwatch.team.id`, `langwatch.organization.id`,
  `langwatch.project.id`, `langwatch.tenant_id`, etc.). Receiver MUST
  re-stamp all 16 to the binding's authoritative principal.
- `provenance.json` — claims values for the 5-key provenance set
  (`langwatch.template.id`, `langwatch.user_ingestion_binding.id`,
  `langwatch.source`, `langwatch.origin`, `langwatch.organization_id`).
  Receiver MUST re-stamp all 5 to match the resolving binding's actual
  identity. Forging `langwatch.origin` or `langwatch.organization_id`
  could otherwise subvert the no-spy / strip-IO governance gate
  (`GovernanceContentStripService.governanceTargetOrgId` discriminator —
  gap #5 from the ralph-loop audit, closed at sergey 3a2ab641e).

For QA convenience, the wrapper's `--forge-tenant-id <id>` flag injects
`langwatch.tenant_id` into the resource attributes orthogonally to the
canned payload — so cross-user isolation regression doesn't need a new
fixture per (attacker, victim) pair.
