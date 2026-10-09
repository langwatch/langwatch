# Insight

Owns insights: short findings about a project that Langy writes into an inbox.

- `contract/`: schemas, the folder rules (`deriveInsightInbox`), errors, the
  `InsightApi` token and the tRPC declaration.
- `process/`: the `insight_processing` pipeline, its two Postgres projections
  and the `InsightModule`.
- `browser/`: the Insights page, the top bar bell, the sidebar count and the
  "Save as insight" action on Langy answers.

Behind the `release_insights` flag. Requirements: [specs](./specs/insight-inbox.feature).
Decisions: [ADRs](./adrs/README.md).
