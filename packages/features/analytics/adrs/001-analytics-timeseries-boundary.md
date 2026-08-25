# ADR-001: Analytics owns the timeseries read capability

**Status:** Accepted

**Behavioural contract:** [Analytics timeseries](../specs/analytics-timeseries.feature)

Analytics owns the portable timeseries, feedback, and top-document read
vocabulary, conservative rollup/slim/legacy table routing, tenant-scoped
query envelopes, ClickHouse query builders, and result validation. Its single
server service has one private repository capability. The application
composition root supplies only concrete ClickHouse client resolution and
transport wiring.

Dashboard owns graphs and saved charts. Topic owns clustering. Trace and
Evaluation own their durable lifecycles. They consume the Analytics service;
they do not add Analytics repositories or query implementations.

The route table is deliberately conservative: mixed sources, keyed or pipeline
series, negated or trace-scoped filters, blocklisted attributes, and unsupported
dimensions use the source's legacy table. Every query carries the project id as
its tenant id. Timeseries bucket counts are capped at 1,000 by normalising to a
daily scale, and the service validates the repository result with the shared
Zod 4 contract.
