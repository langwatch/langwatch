# Insight ADRs

| ADR                                             | Decision                                                                         | Status   |
| ----------------------------------------------- | -------------------------------------------------------------------------------- | -------- |
| [001](./001-insight-aggregate.md)               | One event-sourced aggregate per insight, with a separate reader projection       | Accepted |
| [002](./002-pointer-and-fixed-date-evidence.md) | A pointer to the board and widget, and evidence kept as a query with fixed dates | Accepted |
| [003](./003-personal-insights.md)               | An insight belongs to one person, who alone reads it and acts on it              | Accepted |
| [004](./004-daily-run.md)                       | A daily run is Langy reading one board for one person, read-only and untrusted   | Accepted |
