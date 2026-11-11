# Analytics architecture decisions

- [ADR-001: Analytics timeseries and LangWatchQL web boundary](./001-analytics-timeseries-boundary.md)
- [ADR-002: LangWatchQL chart runtime without eval](./002-lwql-chart-runtime-without-eval.md)
- [ADR-003: A LangWatchQL statement counts the trace origins it reads from a reserved parameter](./003-lwql-sources-parameter.md)
- [ADR-004: Stock widget queries read typed columns, never a map, and hash only the small side](./004-stock-widgets-read-no-map.md)
- [ADR-005: A read bounded below on evaluation_metrics.OccurredAt deduplicates only from that bound](./005-evaluation-metrics-dedup-floor.md)
- [ADR-006: The views the stock widgets read keep each row's latest version without FINAL, over columns the projections write](./006-stock-widget-views-latest-in-order.md)
