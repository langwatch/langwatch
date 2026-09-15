# ADR-025: Trace retention does not run a Postgres orphan sweeper

**Date:** 2026-06-03

**Status:** Accepted

**Related:** [data retention](./022-data-retention.md).

## Context

ClickHouse TTL removes expired trace data. Postgres resources such as
annotations, shares, trigger claims and pins may reference a trace ID without a
database foreign key to ClickHouse.

A background job that scans both stores and deletes those rows couples a
high-volume ingestion system to multi-table cleanup. It adds queue, cursor and
failure-state machinery for records that are safe to leave as dangling product
references.

## Decision

There is no recurring Postgres orphan sweep for rows whose referenced trace has
expired from ClickHouse.

Storage-level trace cleanup remains part of the retention subsystem. Product
features decide how to display a reference whose trace is absent:

- annotation and queue views may hide it or show that the trace expired;
- a public share resolves as missing;
- a trigger claim continues to suppress the same trigger/trace identity; and
- a pin may resolve to a missing trace.

Those read behaviors belong to their feature services. Ingestion does not seed
cleanup work, and no self-perpetuating queue chain owns cross-store deletion.

If accumulated rows become a material storage cost, an operator may run a
bounded, explicit maintenance operation with its own sizing and observability.
That operation is not triggered by trace ingestion.

## Alternatives considered

An ingestion-triggered cleanup chain makes every trace event a possible entry
to expensive Postgres/ClickHouse work. A global recurring sweeper still adds a
permanent cross-store reconciliation service. Read-time handling performs work
only when a customer encounters the dangling reference and keeps the retention
hot path independent.

## Consequences

- The ingestion path cannot be blocked or amplified by orphan cleanup.
- Some Postgres rows outlive their trace and require missing-trace UX.
- `TriggerSent` keeps its trace identity after trace expiry.
- Storage growth is monitored independently and does not justify a hidden
  always-on deleter by default.
