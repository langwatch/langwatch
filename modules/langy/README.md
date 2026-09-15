# langy

Langy is the singular feature for the assistant conversation surface:
conversations, turns, messages, credentials, relay frames, feedback cadence,
and the Langy event-sourcing pipeline.

- `contract/` contains portable Zod 4 vocabulary and the abstract
  `LangyService`.
- `server/` contains the implementation, private repositories, eventing, and
  Redis-backed feedback cadence. Its HTTP worker adapter owns probe, warm,
  dispatch, and cancel calls to the agent manager.
- `web/` contains browser-safe helpers, deterministic behaviour, and reusable
  controlled presentation, including capability resolution, feature-map
  lookups, result formatting, derived cards, choices, failure disclosures, and
  streaming previews. App pages/routes, state, viewer hydration, charts, route
  builders, and transport hooks remain in `apps/ui`.
- `specs/` and `adrs/` record the current behavioural and architectural facts.

The process builds one `LangyService` through `PostgresLangyAdapter` and
injects it into transports and workers. Callers use its flat methods; they do
not create sub-services or access repositories. Existing transport paths and
wire shapes are compatibility surfaces. Boot validates the manager URL and
internal secret as one optional pair, then constructs one HTTP worker adapter
with an explicit metrics port.
