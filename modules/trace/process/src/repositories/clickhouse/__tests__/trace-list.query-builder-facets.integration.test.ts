/**
 * The queryBuilder and dynamic-keys facets on built reads (ADR-202), as the app reader, return
 * main's 26.8 answers, kept as literals, under each scope with another tenant sharing ids.
 * @see modules/trace/specs/trace-filter-built-conditions.feature
 */
import type { Authorization } from "@langwatch/authorization";
import {
  type MigratedAppReaderClickHouse,
  startMigratedAppReaderClickHouse,
} from "@langwatch/test-harness/clickhouse-app-reader";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EVALUATOR_FACET } from "../../../features/facet/repositories/clickhouse/clickhouse.trace-facet-evaluator.repository.ts";
import { EVENT_ATTRIBUTE_KEYS_FACET } from "../../../features/facet/repositories/clickhouse/clickhouse.trace-facet-event-attribute-keys.repository.ts";
import { EVENT_FACET } from "../../../features/facet/repositories/clickhouse/clickhouse.trace-facet-events.repository.ts";
import { LABEL_FACET } from "../../../features/facet/repositories/clickhouse/clickhouse.trace-facet-label.repository.ts";
import {
  METADATA_KEYS_FACET,
  TRACE_METADATA_FACET,
} from "../../../features/facet/repositories/clickhouse/clickhouse.trace-facet-metadata-keys.repository.ts";
import { SPAN_ATTRIBUTE_KEYS_FACET } from "../../../features/facet/repositories/clickhouse/clickhouse.trace-facet-span-attribute-keys.repository.ts";
import { traceFilterCompileFor } from "../../../services/__tests__/fixtures/trace-query-services.fixtures.ts";
import { TRACE_ID_INDEXES } from "../clickhouse.trace-id-indexes.database.ts";
import { TraceListClickHouseRepository } from "../trace-list.repository.ts";
import { facetScopesOf, facetSeedOf, seedFacetRows } from "./support/trace-facet-seed.support.ts";

const NOW = Date.now();
const seed = facetSeedOf({ run: nanoid(6), now: NOW });
const SCOPES = facetScopesOf(seed);

/** The facet filters: none, one on the summary itself, and one on a side table (spans). */
const FILTERS = { none: "", svc: "NOT service:api-b", span: "span.attribute.kind:keep" } as const;
type FilterName = keyof typeof FILTERS;

/** Each facet, and the value prefix its second read narrows by (matched in any case). */
const FACETS = {
  evaluator: { def: EVALUATOR_FACET, prefix: "JU" },
  label: { def: LABEL_FACET, prefix: "PR" },
  event: { def: EVENT_FACET, prefix: "FEED" },
  eventKeys: { def: EVENT_ATTRIBUTE_KEYS_FACET, prefix: "EVENT" },
  spanKeys: { def: SPAN_ATTRIBUTE_KEYS_FACET, prefix: "LANG" },
  metadataKeys: { def: METADATA_KEYS_FACET, prefix: "SERV" },
  metadata: { def: TRACE_METADATA_FACET, prefix: "TE" },
} as const;

const MAIN: Record<string, Record<string, unknown>> = {
  "the member's own proof": {
    "none:evaluator": {
      values: [
        {
          value: "evaluator-1",
          label: "Judge",
          count: 3,
          aggregates: {
            passedCount: 1,
            failedCount: 1,
            erroredCount: 1,
            scoreMin: 0.1,
            scoreMax: 0.9,
            hasScore: true,
            distinctScores: 2,
            hasLabel: true,
            labelValues: [
              { value: "bad", count: 1 },
              { value: "good", count: 1 },
            ],
          },
        },
      ],
      totalDistinct: 1,
    },
    "none:evaluator:JU": {
      values: [
        {
          value: "evaluator-1",
          label: "Judge",
          count: 3,
          aggregates: {
            passedCount: 1,
            failedCount: 1,
            erroredCount: 1,
            scoreMin: 0.1,
            scoreMax: 0.9,
            hasScore: true,
            distinctScores: 2,
            hasLabel: true,
            labelValues: [
              { value: "bad", count: 1 },
              { value: "good", count: 1 },
            ],
          },
        },
      ],
      totalDistinct: 1,
    },
    "none:label": {
      values: [
        { value: "prod", count: 2 },
        { value: "beta", count: 1 },
        { value: "old", count: 1 },
      ],
      totalDistinct: 3,
    },
    "none:label:PR": { values: [{ value: "prod", count: 2 }], totalDistinct: 1 },
    "none:event": {
      values: [
        {
          value: "feedback",
          count: 2,
          eventMetrics: [
            {
              key: "event.metrics.vote",
              values: [
                { value: "0", count: 1 },
                { value: "1", count: 1 },
              ],
            },
          ],
        },
        { value: "retry", count: 1 },
      ],
      totalDistinct: 2,
    },
    "none:event:FEED": {
      values: [
        {
          value: "feedback",
          count: 2,
          eventMetrics: [
            {
              key: "event.metrics.vote",
              values: [
                { value: "0", count: 1 },
                { value: "1", count: 1 },
              ],
            },
          ],
        },
      ],
      totalDistinct: 1,
    },
    "none:eventKeys": {
      values: [
        { value: "event.metrics.vote", count: 2 },
        { value: "attempt", count: 1 },
        { value: "note", count: 1 },
      ],
      totalDistinct: 3,
    },
    "none:eventKeys:EVENT": {
      values: [{ value: "event.metrics.vote", count: 2 }],
      totalDistinct: 1,
    },
    "none:spanKeys": {
      values: [
        { value: "kind", count: 3 },
        { value: "langwatch.span.type", count: 3 },
      ],
      totalDistinct: 2,
    },
    "none:spanKeys:LANG": {
      values: [{ value: "langwatch.span.type", count: 3 }],
      totalDistinct: 1,
    },
    "none:metadataKeys": {
      values: [
        { value: "langwatch.labels", count: 3 },
        { value: "service.name", count: 3 },
        { value: "metadata.team", count: 1 },
      ],
      totalDistinct: 3,
    },
    "none:metadataKeys:SERV": { values: [{ value: "service.name", count: 3 }], totalDistinct: 1 },
    "none:metadata": { values: [{ value: "metadata.team", count: 1 }], totalDistinct: 1 },
    "none:metadata:TE": { values: [{ value: "metadata.team", count: 1 }], totalDistinct: 1 },
    "svc:evaluator": {
      values: [
        {
          value: "evaluator-1",
          label: "Judge",
          count: 2,
          aggregates: {
            passedCount: 1,
            failedCount: 1,
            erroredCount: 0,
            scoreMin: 0.1,
            scoreMax: 0.9,
            hasScore: true,
            distinctScores: 2,
            hasLabel: true,
            labelValues: [
              { value: "bad", count: 1 },
              { value: "good", count: 1 },
            ],
          },
        },
      ],
      totalDistinct: 1,
    },
    "svc:evaluator:JU": {
      values: [
        {
          value: "evaluator-1",
          label: "Judge",
          count: 2,
          aggregates: {
            passedCount: 1,
            failedCount: 1,
            erroredCount: 0,
            scoreMin: 0.1,
            scoreMax: 0.9,
            hasScore: true,
            distinctScores: 2,
            hasLabel: true,
            labelValues: [
              { value: "bad", count: 1 },
              { value: "good", count: 1 },
            ],
          },
        },
      ],
      totalDistinct: 1,
    },
    "svc:label": {
      values: [
        { value: "prod", count: 1 },
        { value: "beta", count: 1 },
        { value: "old", count: 1 },
      ],
      totalDistinct: 3,
    },
    "svc:label:PR": { values: [{ value: "prod", count: 1 }], totalDistinct: 1 },
    "svc:event": {
      values: [
        { value: "retry", count: 1 },
        {
          value: "feedback",
          count: 1,
          eventMetrics: [{ key: "event.metrics.vote", values: [{ value: "1", count: 1 }] }],
        },
      ],
      totalDistinct: 2,
    },
    "svc:event:FEED": {
      values: [
        {
          value: "feedback",
          count: 1,
          eventMetrics: [{ key: "event.metrics.vote", values: [{ value: "1", count: 1 }] }],
        },
      ],
      totalDistinct: 1,
    },
    "svc:eventKeys": {
      values: [
        { value: "attempt", count: 1 },
        { value: "note", count: 1 },
        { value: "event.metrics.vote", count: 1 },
      ],
      totalDistinct: 3,
    },
    "svc:eventKeys:EVENT": {
      values: [{ value: "event.metrics.vote", count: 1 }],
      totalDistinct: 1,
    },
    "svc:spanKeys": {
      values: [
        { value: "kind", count: 2 },
        { value: "langwatch.span.type", count: 2 },
      ],
      totalDistinct: 2,
    },
    "svc:spanKeys:LANG": { values: [{ value: "langwatch.span.type", count: 2 }], totalDistinct: 1 },
    "svc:metadataKeys": {
      values: [
        { value: "langwatch.labels", count: 2 },
        { value: "service.name", count: 2 },
        { value: "metadata.team", count: 1 },
      ],
      totalDistinct: 3,
    },
    "svc:metadataKeys:SERV": { values: [{ value: "service.name", count: 2 }], totalDistinct: 1 },
    "svc:metadata": { values: [{ value: "metadata.team", count: 1 }], totalDistinct: 1 },
    "svc:metadata:TE": { values: [{ value: "metadata.team", count: 1 }], totalDistinct: 1 },
    "span:evaluator": {
      values: [
        {
          value: "evaluator-1",
          label: "Judge",
          count: 2,
          aggregates: {
            passedCount: 1,
            failedCount: 1,
            erroredCount: 0,
            scoreMin: 0.1,
            scoreMax: 0.9,
            hasScore: true,
            distinctScores: 2,
            hasLabel: true,
            labelValues: [
              { value: "bad", count: 1 },
              { value: "good", count: 1 },
            ],
          },
        },
      ],
      totalDistinct: 1,
    },
    "span:evaluator:JU": {
      values: [
        {
          value: "evaluator-1",
          label: "Judge",
          count: 2,
          aggregates: {
            passedCount: 1,
            failedCount: 1,
            erroredCount: 0,
            scoreMin: 0.1,
            scoreMax: 0.9,
            hasScore: true,
            distinctScores: 2,
            hasLabel: true,
            labelValues: [
              { value: "bad", count: 1 },
              { value: "good", count: 1 },
            ],
          },
        },
      ],
      totalDistinct: 1,
    },
    "span:label": {
      values: [
        { value: "prod", count: 1 },
        { value: "beta", count: 1 },
        { value: "old", count: 1 },
      ],
      totalDistinct: 3,
    },
    "span:label:PR": { values: [{ value: "prod", count: 1 }], totalDistinct: 1 },
    "span:event": {
      values: [
        { value: "retry", count: 1 },
        {
          value: "feedback",
          count: 1,
          eventMetrics: [{ key: "event.metrics.vote", values: [{ value: "1", count: 1 }] }],
        },
      ],
      totalDistinct: 2,
    },
    "span:event:FEED": {
      values: [
        {
          value: "feedback",
          count: 1,
          eventMetrics: [{ key: "event.metrics.vote", values: [{ value: "1", count: 1 }] }],
        },
      ],
      totalDistinct: 1,
    },
    "span:eventKeys": {
      values: [
        { value: "attempt", count: 1 },
        { value: "note", count: 1 },
        { value: "event.metrics.vote", count: 1 },
      ],
      totalDistinct: 3,
    },
    "span:eventKeys:EVENT": {
      values: [{ value: "event.metrics.vote", count: 1 }],
      totalDistinct: 1,
    },
    "span:spanKeys": {
      values: [
        { value: "kind", count: 2 },
        { value: "langwatch.span.type", count: 2 },
      ],
      totalDistinct: 2,
    },
    "span:spanKeys:LANG": {
      values: [{ value: "langwatch.span.type", count: 2 }],
      totalDistinct: 1,
    },
    "span:metadataKeys": {
      values: [
        { value: "langwatch.labels", count: 2 },
        { value: "service.name", count: 2 },
        { value: "metadata.team", count: 1 },
      ],
      totalDistinct: 3,
    },
    "span:metadataKeys:SERV": { values: [{ value: "service.name", count: 2 }], totalDistinct: 1 },
    "span:metadata": { values: [{ value: "metadata.team", count: 1 }], totalDistinct: 1 },
    "span:metadata:TE": { values: [{ value: "metadata.team", count: 1 }], totalDistinct: 1 },
  },
  "an aggregate's tenant set": {
    "none:evaluator": {
      values: [
        {
          value: "evaluator-1",
          label: "Judge",
          count: 4,
          aggregates: {
            passedCount: 1,
            failedCount: 2,
            erroredCount: 1,
            scoreMin: 0.1,
            scoreMax: 0.9,
            hasScore: true,
            distinctScores: 3,
            hasLabel: true,
            labelValues: [
              { value: "bad", count: 1 },
              { value: "good", count: 1 },
              { value: "meh", count: 1 },
            ],
          },
        },
      ],
      totalDistinct: 1,
    },
    "none:evaluator:JU": {
      values: [
        {
          value: "evaluator-1",
          label: "Judge",
          count: 4,
          aggregates: {
            passedCount: 1,
            failedCount: 2,
            erroredCount: 1,
            scoreMin: 0.1,
            scoreMax: 0.9,
            hasScore: true,
            distinctScores: 3,
            hasLabel: true,
            labelValues: [
              { value: "bad", count: 1 },
              { value: "good", count: 1 },
              { value: "meh", count: 1 },
            ],
          },
        },
      ],
      totalDistinct: 1,
    },
    "none:label": {
      values: [
        { value: "prod", count: 2 },
        { value: "beta", count: 1 },
        { value: "old", count: 1 },
        { value: "agg", count: 1 },
      ],
      totalDistinct: 4,
    },
    "none:label:PR": { values: [{ value: "prod", count: 2 }], totalDistinct: 1 },
    "none:event": {
      values: [
        {
          value: "feedback",
          count: 3,
          eventMetrics: [
            {
              key: "event.metrics.vote",
              values: [
                { value: "1", count: 2 },
                { value: "0", count: 1 },
              ],
            },
          ],
        },
        { value: "retry", count: 1 },
      ],
      totalDistinct: 2,
    },
    "none:event:FEED": {
      values: [
        {
          value: "feedback",
          count: 3,
          eventMetrics: [
            {
              key: "event.metrics.vote",
              values: [
                { value: "1", count: 2 },
                { value: "0", count: 1 },
              ],
            },
          ],
        },
      ],
      totalDistinct: 1,
    },
    "none:eventKeys": {
      values: [
        { value: "event.metrics.vote", count: 3 },
        { value: "attempt", count: 1 },
        { value: "note", count: 1 },
      ],
      totalDistinct: 3,
    },
    "none:eventKeys:EVENT": {
      values: [{ value: "event.metrics.vote", count: 3 }],
      totalDistinct: 1,
    },
    "none:spanKeys": {
      values: [
        { value: "kind", count: 4 },
        { value: "langwatch.span.type", count: 4 },
      ],
      totalDistinct: 2,
    },
    "none:spanKeys:LANG": {
      values: [{ value: "langwatch.span.type", count: 4 }],
      totalDistinct: 1,
    },
    "none:metadataKeys": {
      values: [
        { value: "langwatch.labels", count: 4 },
        { value: "service.name", count: 4 },
        { value: "metadata.team", count: 2 },
      ],
      totalDistinct: 3,
    },
    "none:metadataKeys:SERV": { values: [{ value: "service.name", count: 4 }], totalDistinct: 1 },
    "none:metadata": { values: [{ value: "metadata.team", count: 2 }], totalDistinct: 1 },
    "none:metadata:TE": { values: [{ value: "metadata.team", count: 2 }], totalDistinct: 1 },
    "svc:evaluator": {
      values: [
        {
          value: "evaluator-1",
          label: "Judge",
          count: 3,
          aggregates: {
            passedCount: 1,
            failedCount: 2,
            erroredCount: 0,
            scoreMin: 0.1,
            scoreMax: 0.9,
            hasScore: true,
            distinctScores: 3,
            hasLabel: true,
            labelValues: [
              { value: "bad", count: 1 },
              { value: "good", count: 1 },
              { value: "meh", count: 1 },
            ],
          },
        },
      ],
      totalDistinct: 1,
    },
    "svc:evaluator:JU": {
      values: [
        {
          value: "evaluator-1",
          label: "Judge",
          count: 3,
          aggregates: {
            passedCount: 1,
            failedCount: 2,
            erroredCount: 0,
            scoreMin: 0.1,
            scoreMax: 0.9,
            hasScore: true,
            distinctScores: 3,
            hasLabel: true,
            labelValues: [
              { value: "bad", count: 1 },
              { value: "good", count: 1 },
              { value: "meh", count: 1 },
            ],
          },
        },
      ],
      totalDistinct: 1,
    },
    "svc:label": {
      values: [
        { value: "prod", count: 1 },
        { value: "beta", count: 1 },
        { value: "old", count: 1 },
        { value: "agg", count: 1 },
      ],
      totalDistinct: 4,
    },
    "svc:label:PR": { values: [{ value: "prod", count: 1 }], totalDistinct: 1 },
    "svc:event": {
      values: [
        {
          value: "feedback",
          count: 2,
          eventMetrics: [{ key: "event.metrics.vote", values: [{ value: "1", count: 2 }] }],
        },
        { value: "retry", count: 1 },
      ],
      totalDistinct: 2,
    },
    "svc:event:FEED": {
      values: [
        {
          value: "feedback",
          count: 2,
          eventMetrics: [{ key: "event.metrics.vote", values: [{ value: "1", count: 2 }] }],
        },
      ],
      totalDistinct: 1,
    },
    "svc:eventKeys": {
      values: [
        { value: "event.metrics.vote", count: 2 },
        { value: "attempt", count: 1 },
        { value: "note", count: 1 },
      ],
      totalDistinct: 3,
    },
    "svc:eventKeys:EVENT": {
      values: [{ value: "event.metrics.vote", count: 2 }],
      totalDistinct: 1,
    },
    "svc:spanKeys": {
      values: [
        { value: "kind", count: 3 },
        { value: "langwatch.span.type", count: 3 },
      ],
      totalDistinct: 2,
    },
    "svc:spanKeys:LANG": { values: [{ value: "langwatch.span.type", count: 3 }], totalDistinct: 1 },
    "svc:metadataKeys": {
      values: [
        { value: "langwatch.labels", count: 3 },
        { value: "service.name", count: 3 },
        { value: "metadata.team", count: 2 },
      ],
      totalDistinct: 3,
    },
    "svc:metadataKeys:SERV": { values: [{ value: "service.name", count: 3 }], totalDistinct: 1 },
    "svc:metadata": { values: [{ value: "metadata.team", count: 2 }], totalDistinct: 1 },
    "svc:metadata:TE": { values: [{ value: "metadata.team", count: 2 }], totalDistinct: 1 },
    "span:evaluator": {
      values: [
        {
          value: "evaluator-1",
          label: "Judge",
          count: 3,
          aggregates: {
            passedCount: 1,
            failedCount: 2,
            erroredCount: 0,
            scoreMin: 0.1,
            scoreMax: 0.9,
            hasScore: true,
            distinctScores: 3,
            hasLabel: true,
            labelValues: [
              { value: "bad", count: 1 },
              { value: "good", count: 1 },
              { value: "meh", count: 1 },
            ],
          },
        },
      ],
      totalDistinct: 1,
    },
    "span:evaluator:JU": {
      values: [
        {
          value: "evaluator-1",
          label: "Judge",
          count: 3,
          aggregates: {
            passedCount: 1,
            failedCount: 2,
            erroredCount: 0,
            scoreMin: 0.1,
            scoreMax: 0.9,
            hasScore: true,
            distinctScores: 3,
            hasLabel: true,
            labelValues: [
              { value: "bad", count: 1 },
              { value: "good", count: 1 },
              { value: "meh", count: 1 },
            ],
          },
        },
      ],
      totalDistinct: 1,
    },
    "span:label": {
      values: [
        { value: "prod", count: 1 },
        { value: "beta", count: 1 },
        { value: "old", count: 1 },
        { value: "agg", count: 1 },
      ],
      totalDistinct: 4,
    },
    "span:label:PR": { values: [{ value: "prod", count: 1 }], totalDistinct: 1 },
    "span:event": {
      values: [
        {
          value: "feedback",
          count: 2,
          eventMetrics: [{ key: "event.metrics.vote", values: [{ value: "1", count: 2 }] }],
        },
        { value: "retry", count: 1 },
      ],
      totalDistinct: 2,
    },
    "span:event:FEED": {
      values: [
        {
          value: "feedback",
          count: 2,
          eventMetrics: [{ key: "event.metrics.vote", values: [{ value: "1", count: 2 }] }],
        },
      ],
      totalDistinct: 1,
    },
    "span:eventKeys": {
      values: [
        { value: "event.metrics.vote", count: 2 },
        { value: "attempt", count: 1 },
        { value: "note", count: 1 },
      ],
      totalDistinct: 3,
    },
    "span:eventKeys:EVENT": {
      values: [{ value: "event.metrics.vote", count: 2 }],
      totalDistinct: 1,
    },
    "span:spanKeys": {
      values: [
        { value: "kind", count: 3 },
        { value: "langwatch.span.type", count: 3 },
      ],
      totalDistinct: 2,
    },
    "span:spanKeys:LANG": {
      values: [{ value: "langwatch.span.type", count: 3 }],
      totalDistinct: 1,
    },
    "span:metadataKeys": {
      values: [
        { value: "langwatch.labels", count: 3 },
        { value: "service.name", count: 3 },
        { value: "metadata.team", count: 2 },
      ],
      totalDistinct: 3,
    },
    "span:metadataKeys:SERV": { values: [{ value: "service.name", count: 3 }], totalDistinct: 1 },
    "span:metadata": { values: [{ value: "metadata.team", count: 2 }], totalDistinct: 1 },
    "span:metadata:TE": { values: [{ value: "metadata.team", count: 2 }], totalDistinct: 1 },
  },
  "a windowed share": {
    "none:evaluator": {
      values: [
        {
          value: "evaluator-1",
          label: "Judge",
          count: 3,
          aggregates: {
            passedCount: 1,
            failedCount: 1,
            erroredCount: 1,
            scoreMin: 0.5,
            scoreMax: 0.9,
            hasScore: true,
            distinctScores: 2,
            hasLabel: true,
            labelValues: [
              { value: "good", count: 1 },
              { value: "meh", count: 1 },
            ],
          },
        },
      ],
      totalDistinct: 1,
    },
    "none:evaluator:JU": {
      values: [
        {
          value: "evaluator-1",
          label: "Judge",
          count: 3,
          aggregates: {
            passedCount: 1,
            failedCount: 1,
            erroredCount: 1,
            scoreMin: 0.5,
            scoreMax: 0.9,
            hasScore: true,
            distinctScores: 2,
            hasLabel: true,
            labelValues: [
              { value: "good", count: 1 },
              { value: "meh", count: 1 },
            ],
          },
        },
      ],
      totalDistinct: 1,
    },
    "none:label": {
      values: [
        { value: "prod", count: 2 },
        { value: "beta", count: 1 },
        { value: "agg", count: 1 },
      ],
      totalDistinct: 3,
    },
    "none:label:PR": { values: [{ value: "prod", count: 2 }], totalDistinct: 1 },
    "none:event": {
      values: [
        {
          value: "feedback",
          count: 3,
          eventMetrics: [
            {
              key: "event.metrics.vote",
              values: [
                { value: "1", count: 2 },
                { value: "0", count: 1 },
              ],
            },
          ],
        },
      ],
      totalDistinct: 1,
    },
    "none:event:FEED": {
      values: [
        {
          value: "feedback",
          count: 3,
          eventMetrics: [
            {
              key: "event.metrics.vote",
              values: [
                { value: "1", count: 2 },
                { value: "0", count: 1 },
              ],
            },
          ],
        },
      ],
      totalDistinct: 1,
    },
    "none:eventKeys": {
      values: [
        { value: "event.metrics.vote", count: 3 },
        { value: "note", count: 1 },
      ],
      totalDistinct: 2,
    },
    "none:eventKeys:EVENT": {
      values: [{ value: "event.metrics.vote", count: 3 }],
      totalDistinct: 1,
    },
    "none:spanKeys": {
      values: [
        { value: "kind", count: 3 },
        { value: "langwatch.span.type", count: 3 },
      ],
      totalDistinct: 2,
    },
    "none:spanKeys:LANG": {
      values: [{ value: "langwatch.span.type", count: 3 }],
      totalDistinct: 1,
    },
    "none:metadataKeys": {
      values: [
        { value: "langwatch.labels", count: 3 },
        { value: "service.name", count: 3 },
        { value: "metadata.team", count: 2 },
      ],
      totalDistinct: 3,
    },
    "none:metadataKeys:SERV": { values: [{ value: "service.name", count: 3 }], totalDistinct: 1 },
    "none:metadata": { values: [{ value: "metadata.team", count: 2 }], totalDistinct: 1 },
    "none:metadata:TE": { values: [{ value: "metadata.team", count: 2 }], totalDistinct: 1 },
    "svc:evaluator": {
      values: [
        {
          value: "evaluator-1",
          label: "Judge",
          count: 2,
          aggregates: {
            passedCount: 1,
            failedCount: 1,
            erroredCount: 0,
            scoreMin: 0.5,
            scoreMax: 0.9,
            hasScore: true,
            distinctScores: 2,
            hasLabel: true,
            labelValues: [
              { value: "good", count: 1 },
              { value: "meh", count: 1 },
            ],
          },
        },
      ],
      totalDistinct: 1,
    },
    "svc:evaluator:JU": {
      values: [
        {
          value: "evaluator-1",
          label: "Judge",
          count: 2,
          aggregates: {
            passedCount: 1,
            failedCount: 1,
            erroredCount: 0,
            scoreMin: 0.5,
            scoreMax: 0.9,
            hasScore: true,
            distinctScores: 2,
            hasLabel: true,
            labelValues: [
              { value: "good", count: 1 },
              { value: "meh", count: 1 },
            ],
          },
        },
      ],
      totalDistinct: 1,
    },
    "svc:label": {
      values: [
        { value: "prod", count: 1 },
        { value: "beta", count: 1 },
        { value: "agg", count: 1 },
      ],
      totalDistinct: 3,
    },
    "svc:label:PR": { values: [{ value: "prod", count: 1 }], totalDistinct: 1 },
    "svc:event": {
      values: [
        {
          value: "feedback",
          count: 2,
          eventMetrics: [{ key: "event.metrics.vote", values: [{ value: "1", count: 2 }] }],
        },
      ],
      totalDistinct: 1,
    },
    "svc:event:FEED": {
      values: [
        {
          value: "feedback",
          count: 2,
          eventMetrics: [{ key: "event.metrics.vote", values: [{ value: "1", count: 2 }] }],
        },
      ],
      totalDistinct: 1,
    },
    "svc:eventKeys": {
      values: [
        { value: "event.metrics.vote", count: 2 },
        { value: "note", count: 1 },
      ],
      totalDistinct: 2,
    },
    "svc:eventKeys:EVENT": {
      values: [{ value: "event.metrics.vote", count: 2 }],
      totalDistinct: 1,
    },
    "svc:spanKeys": {
      values: [
        { value: "kind", count: 2 },
        { value: "langwatch.span.type", count: 2 },
      ],
      totalDistinct: 2,
    },
    "svc:spanKeys:LANG": { values: [{ value: "langwatch.span.type", count: 2 }], totalDistinct: 1 },
    "svc:metadataKeys": {
      values: [
        { value: "langwatch.labels", count: 2 },
        { value: "metadata.team", count: 2 },
        { value: "service.name", count: 2 },
      ],
      totalDistinct: 3,
    },
    "svc:metadataKeys:SERV": { values: [{ value: "service.name", count: 2 }], totalDistinct: 1 },
    "svc:metadata": { values: [{ value: "metadata.team", count: 2 }], totalDistinct: 1 },
    "svc:metadata:TE": { values: [{ value: "metadata.team", count: 2 }], totalDistinct: 1 },
    "span:evaluator": {
      values: [
        {
          value: "evaluator-1",
          label: "Judge",
          count: 2,
          aggregates: {
            passedCount: 1,
            failedCount: 1,
            erroredCount: 0,
            scoreMin: 0.5,
            scoreMax: 0.9,
            hasScore: true,
            distinctScores: 2,
            hasLabel: true,
            labelValues: [
              { value: "good", count: 1 },
              { value: "meh", count: 1 },
            ],
          },
        },
      ],
      totalDistinct: 1,
    },
    "span:evaluator:JU": {
      values: [
        {
          value: "evaluator-1",
          label: "Judge",
          count: 2,
          aggregates: {
            passedCount: 1,
            failedCount: 1,
            erroredCount: 0,
            scoreMin: 0.5,
            scoreMax: 0.9,
            hasScore: true,
            distinctScores: 2,
            hasLabel: true,
            labelValues: [
              { value: "good", count: 1 },
              { value: "meh", count: 1 },
            ],
          },
        },
      ],
      totalDistinct: 1,
    },
    "span:label": {
      values: [
        { value: "prod", count: 1 },
        { value: "beta", count: 1 },
        { value: "agg", count: 1 },
      ],
      totalDistinct: 3,
    },
    "span:label:PR": { values: [{ value: "prod", count: 1 }], totalDistinct: 1 },
    "span:event": {
      values: [
        {
          value: "feedback",
          count: 2,
          eventMetrics: [{ key: "event.metrics.vote", values: [{ value: "1", count: 2 }] }],
        },
      ],
      totalDistinct: 1,
    },
    "span:event:FEED": {
      values: [
        {
          value: "feedback",
          count: 2,
          eventMetrics: [{ key: "event.metrics.vote", values: [{ value: "1", count: 2 }] }],
        },
      ],
      totalDistinct: 1,
    },
    "span:eventKeys": {
      values: [
        { value: "event.metrics.vote", count: 2 },
        { value: "note", count: 1 },
      ],
      totalDistinct: 2,
    },
    "span:eventKeys:EVENT": {
      values: [{ value: "event.metrics.vote", count: 2 }],
      totalDistinct: 1,
    },
    "span:spanKeys": {
      values: [
        { value: "kind", count: 2 },
        { value: "langwatch.span.type", count: 2 },
      ],
      totalDistinct: 2,
    },
    "span:spanKeys:LANG": {
      values: [{ value: "langwatch.span.type", count: 2 }],
      totalDistinct: 1,
    },
    "span:metadataKeys": {
      values: [
        { value: "langwatch.labels", count: 2 },
        { value: "metadata.team", count: 2 },
        { value: "service.name", count: 2 },
      ],
      totalDistinct: 3,
    },
    "span:metadataKeys:SERV": { values: [{ value: "service.name", count: 2 }], totalDistinct: 1 },
    "span:metadata": { values: [{ value: "metadata.team", count: 2 }], totalDistinct: 1 },
    "span:metadata:TE": { values: [{ value: "metadata.team", count: 2 }], totalDistinct: 1 },
  },
};

let ch: MigratedAppReaderClickHouse;
let repo: TraceListClickHouseRepository;

/** Each facet's values most frequent first, ties in value order. */
function normalised(answer: unknown): unknown {
  if (Array.isArray(answer) || answer === null || typeof answer !== "object") return answer;
  return Object.fromEntries(
    Object.entries(answer).map(([key, value]) => [
      key,
      key === "values" && Array.isArray(value)
        ? (value as { value: string; count: number }[]).toSorted(
            (a, b) => b.count - a.count || a.value.localeCompare(b.value),
          )
        : normalised(value),
    ]),
  );
}

function compileOf(filter: FilterName) {
  return filter === "none"
    ? {}
    : {
        compileFilter: traceFilterCompileFor({
          queryText: FILTERS[filter],
          timeRange: seed.window,
        }),
      };
}

/** Every queryBuilder facet read, with and without its prefix, under one proof and one filter. */
async function facetAnswers(authorization: Authorization, filter: FilterName) {
  const answers: Record<string, unknown> = {};
  for (const [key, { def, prefix }] of Object.entries(FACETS)) {
    for (const narrowed of [undefined, prefix]) {
      const query = def.queryBuilder({
        authorization,
        timeRange: seed.window,
        limit: 50,
        offset: 0,
        ...(narrowed ? { prefix: narrowed } : {}),
        ...compileOf(filter),
      });
      answers[`${filter}:${key}${narrowed ? `:${narrowed}` : ""}`] =
        await repo.findQueryBuilderFacet({ table: def.table, query });
    }
  }
  return answers;
}

beforeAll(async () => {
  ch = await startMigratedAppReaderClickHouse({
    suite: "trace-query-builder-facets",
    indexes: TRACE_ID_INDEXES,
    environment: process.env,
  });
  await seedFacetRows({
    seed,
    now: NOW,
    insert: (table, values) => ch.admin.insert({ table, values, format: "JSONEachRow" }),
  });
  repo = TraceListClickHouseRepository.create({ reader: ch.reader });
}, 300_000);

afterAll(async () => {
  await ch?.close();
});

describe("the queryBuilder facet reads on built statements", () => {
  /** @scenario "QueryBuilder facets keep main's answers under each scope" */
  it.each(SCOPES)("counts every queryBuilder facet under %s as main does", async (name, proof) => {
    for (const filter of Object.keys(FILTERS) as FilterName[]) {
      const built = normalised(await facetAnswers(proof(), filter));
      const main = normalised(
        Object.fromEntries(
          Object.entries(MAIN[name]!).filter(([key]) => key.startsWith(`${filter}:`)),
        ),
      );
      expect(built).toEqual(main);
    }
  });

  /** @scenario "Under a windowed share the queryBuilder facets count the traces the list shows" */
  it("counts under a windowed share the traces the list returns for the same filter", async () => {
    const proof = SCOPES[2]![1];
    const { compileFilter } = compileOf("span");
    const list = await repo.listAll({
      authorization: proof(),
      timeRange: seed.window,
      sort: { column: "OccurredAt", direction: "desc" },
      limit: 50,
      compileFilter,
    });
    const keys = await repo.findQueryBuilderFacet({
      table: "trace_summaries",
      query: METADATA_KEYS_FACET.queryBuilder({
        authorization: proof(),
        timeRange: seed.window,
        limit: 50,
        offset: 0,
        prefix: "service.name",
        compileFilter,
      }),
    });

    expect(keys.values).toEqual([{ value: "service.name", count: list.rows.length }]);
    expect(list.rows).toHaveLength(2);
  });
});
