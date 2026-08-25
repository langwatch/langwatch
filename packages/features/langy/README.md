# langy

Langy is the singular feature for the assistant conversation surface:
conversations, turns, messages, credentials, relay frames, feedback cadence,
and the Langy event-sourcing pipeline.

- `contract/` contains portable Zod 4 vocabulary and the abstract
  `LangyService`.
- `server/` contains the implementation, private repositories, eventing, and
  Redis-backed feedback cadence.
- `web/` contains browser-facing contract helpers.
- `specs/` and `adrs/` record the current behavioural and architectural facts.

The process builds one `LangyService` through `PostgresLangyAdapter` and
injects it into transports and workers. Callers use its flat methods; they do
not create sub-services or access repositories. Existing transport paths and
wire shapes are compatibility surfaces.
