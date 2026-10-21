# Platform architecture blocks: rule decisions (Alex, 2026-10-20)

Source: review of #8815/#8675/#8829/#8830 and 117 PRs merged 10-06..10-20.
"Fix" = clear main in this PR, rule blocks at zero. "Shrink" = enforcer policy
reports every finding, a shrink-only count per rule|file under
packages/architecture-enforcer/tests/baselines, compared by
tests/boundary-ratchets.unit.test.ts (ARCHITECTURE.md §17 gains these rules).

| #   | Rule                                                                                                                                                   | Decision     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| 1   | no-raw-color: var(--chakra-colors-*), hex, rgb() in style props outside design-system                                                                  | shrink       |
| 2   | foreign-error-code: literal equal to another module's declared error code in ===, case, Record key                                                     | fix          |
| 3   | peer-route-literal: literal equal to / prefixed by another module's *.web.ts path                                                                      | shrink       |
| 4   | duplicate-across-modules: byte-identical non-test source in 2+ modules                                                                                 | shrink       |
| 5   | library kind deleted: a module folder other than contract/process/browser/client is a violation; analytics-filters moves into analytics-contract       | fix          |
| 6   | DS recomposition: chakra.button/chakra.input, ChakraLink/primitive Link with in-app href, Text red.fg holding errors.*.message, in module browser code | shrink       |
| 7a  | metric instruments only in a _-metrics service, names langwatch__, prom-client only in packages/observability                                          | fix          |
| 7b  | no node:http / writeHead under services/                                                                                                               | fix          |
| 7c  | find* returning [x]/[] and callers taking (await find*())[0]                                                                                           | fix          |
| 7d  | catch comparing .code to a literal then returning null/undefined                                                                                       | fix          |
| 8   | raw caught error .message into JSX child/attribute or set* state (browser + apps); sentence copy in a contract `message` field built in process code   | fix          |
| 9   | parity: tolerance per scenario title (shrink-only), @scenario on an untagged scenario fails, @unimplemented must cite an issue                         | fix          |
| 10  | ADR number uniqueness                                                                                                                                  | shrink       |
| 11  | teaching-citations widened: dev/docs/best_practices fix; docs/, specs/, rest of dev/docs shrink                                                        | fix + shrink |
| 12a | no _Api input field named exempt_/bypass*/skip*Limit                                                                                                   | fix          |
| 12b | contract constant tagged @ownerOnly unusable outside its module                                                                                        | fix          |
| 12c | contract export *_MS/_RETRIES/_ATTEMPTS/_TIMEOUT/_INTERVAL not importable by another module                                                            | fix          |
| 12d | no z.preprocess in event payload schemas                                                                                                               | fix          |
| 13a | Prisma ownership derived from schema for every model, incl. Pick<PrismaClient[...]>                                                                    | shrink       |
| 13b | browser features/<dir> named after another module                                                                                                      | shrink       |
| 13c | one declaring class per non-generic error code                                                                                                         | shrink       |
| 13d | service using 4+ operations of one peer *Api                                                                                                           | shrink       |
| 14a | guard trigger: edit to an exemption list inside a rule or policy                                                                                       | guard        |
| 14b | guard trigger: a test budget number raised                                                                                                             | guard        |
| 15  | timing workarounds in browser code (recursive rAF, document.querySelector, setTimeout re-read chains)                                                  | shrink       |
| 16  | literal restating an exported contract string constant (10+ chars)                                                                                     | shrink       |
| G   | ask-your-human guard (architecture-section-check): done                                                                                                | guard        |

Naming (Q): no change. ADR-146 already enforces get=one/throws, find=array, list=page.

Rule 2 idiom (Alex, 2026-10-20): error classes already live in contracts. Each class
declares `static readonly code = "<code>" as const` and passes it to super; the base
`HandledError.is(error)` matches by instanceof OR by code on a serialised payload.
Callers import the owner's class and write `WorkflowNotFoundError.is(error)` in process
and browser alike. foreign-error-code refuses the literal.

## Rulings, 2026-10-20 (later)

- find*/list* may answer [] or [x] when nothing failed; no result union. Rule 7c dropped entirely.
- 7d no-code-catch-to-null: shrink (89). Fix = call a find* and read [], never catch a get* into null.
- 7b no-transport-in-service: fix by splitting hosted-mcp services into pure decision + thin transport adapter taking the service by injection.
- §10.1 change: a client lends a ready component (`lentComponent(Token)` from browser-host); borrowers stop writing lent-* wrappers (~69 deleted). In this PR.
- Retire packages/design-system/.storybook/raw-colours.ts + raw-colour-allowlist.json (raw-colour policy replaces it).
- peer-api-fan-in: _.app.ts composition roots OUT of scope. Go-mirror codes, sso-_ dirs, share's Grant claim: count.
- Defaults kept: network retry backoff not a timing workaround; apps/ui/vite splash skipped; ADR numbers unique per folder; openai_admin/workbench_sql counted; ui-route-table.ts counted.
- 12c insight: insight's schedule read model answers `daysUntilOff`; ops never sees the threshold. Run key: api-key takes `minRemainingMs: "fresh"`; `RUN_KEY_LIFETIME_MS` leaves the contract.
- 12d: version the SSO registration event (`.v2`, matching the one `.v2` precedent) and upcast v1 in the pipeline. The event-log read seat applies pipeline upcasts; the v1 schema and transform live in identity's contract so peers' stand-ins reuse them.
- 12b: e2e page objects stay out of owner-only-constant's scope, as tests and fixtures are.
- Insight gets a client (clients on demand), and its lent tokens live there like every other module's.
- 7b hosted-mcp: door types live in the contract; the service's stream answer is data only (SDK transport + api key) and the door is given the session runner by injection; the service returns the access-log record and the door adds status and duration.
- Rule 8: browser half fixed and blocking (`no-raw-error-message-in-ui`). Process/contract sentence copy in a handled error's message: shrink list (`handled-error-sentence-copy`). Typed failure values the UI renders (chart query, HTTP test) take copy from the registry by code, and the rule covers them. A local `JSON.parse` SyntaxError message may show. The design-system raw-toast test and its `no-raw-error-toast-ok` markers retire into rule 8.
- Read seat: `EventSourcing` wraps whatever seat it is handed with the pipelines' upcasts (covers every reader through eventing; a bare seat outside it stays raw).
- `handled-error-sentence-copy` counts `{ code, message }` literals only; `super(code, "Sentence")` stays legal (error-handling.md). The retired toast test's two other checks (failure raised on the toaster, a module's own toaster) come back as oxlint rules. The agent HTTP test engine gives every failure a code; the endpoint's body stays visible as data.
- The four toasts no-failure-on-toaster found go through the host port with codes (clipboard) and a new optional action on the failure call (model-provider swap); retyping a failure as a warning to pass the rule is not allowed.
- A failed AI call is a failure: model-provider's AI-call toast gets a code and goes through the host port. A registry headline built from meta replaces a call-site title override.
- Final review rulings (Alex, 2026-10-20): `no-transport-in-service` widens to `new Response(...)` and `statusCode`/`setHeader`/`end` on a response, and auth-door, image-proxy and the workflow sync relay split like hosted-mcp; a stored v1 SSO registration the schema rejects fails the read loud, with the v1 schema frozen and the read seat parsing what it upcasts; `failed` takes `sticky: true` for a failure whose action the user must take.
- `no-raw-error-message-in-ui` follows a message through wrapper calls; SSO test sign-in and the model-provider tile take registry copy by code; a form-field error is not a caught error (Alex, 2026-10-20). A metric instrument in a module lives in a file named for metrics: the enforcer policy `metric-instrument-home` keeps today's offenders on a shrink list; `packages/` stays ungoverned (Alex, 2026-10-20).
- A module's contract or process production code does not value-import a package its package.json lists only in devDependencies (Alex, 2026-10-20): the packed-artifact smoke boot crashed with ERR_MODULE_NOT_FOUND when `agent-connect-refusal.rules.ts` imported `@langwatch/api-key-contract` as a devDependency. The enforcer policy `runtime-dev-dependency` runs at zero in the blocking CI step; browser code is bundled and out of scope.
- A scenario hook result's error is the customer's own output: no-raw-error-message-in-ui accepts it like trace and span text (Alex, 2026-10-20).
