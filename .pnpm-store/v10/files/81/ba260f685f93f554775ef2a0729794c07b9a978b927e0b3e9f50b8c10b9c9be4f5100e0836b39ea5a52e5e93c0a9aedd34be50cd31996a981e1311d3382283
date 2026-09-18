/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
import { ValueType } from '@opentelemetry/api';
import { AggregationTemporality, DataPointType, } from '@opentelemetry/sdk-metrics';
import { writeInstrumentationScope, writeResource, writeAttributes, writeHrTimeAsFixed64, } from '../../common/protobuf/common-serializer';
import { ProtobufSizeEstimator } from '../../common/protobuf/protobuf-size-estimator';
import { ProtobufWriter } from '../../common/protobuf/protobuf-writer';
/**
 * Serialize a NumberDataPoint directly from SDK DataPoint<number>
 *
 * Proto fields (NumberDataPoint):
 *   7  attributes               repeated KeyValue  (wire type 2)
 *   2  start_time_unix_nano     fixed64            (wire type 1)
 *   3  time_unix_nano           fixed64            (wire type 1)
 *   4  as_double                double             (wire type 1)
 *   6  as_int                   sfixed64           (wire type 1)
 *   5  exemplars                repeated Exemplar  (wire type 2)
 *   8  flags                    uint32             (wire type 0)
 */
function serializeNumberDataPoint(writer, dataPoint, valueType) {
    const start = writer.startLengthDelimited();
    const startPos = writer.pos;
    // start_time_unix_nano (field 2, fixed64)
    writer.writeTag(2, 1);
    writeHrTimeAsFixed64(writer, dataPoint.startTime);
    // time_unix_nano (field 3, fixed64)
    writer.writeTag(3, 1);
    writeHrTimeAsFixed64(writer, dataPoint.endTime);
    // value oneof: as_double (field 4) or as_int (field 6)
    if (valueType === ValueType.INT) {
        writer.writeTag(6, 1); // sfixed64, wire type 1
        writer.writeSfixed64(dataPoint.value);
    }
    else {
        writer.writeTag(4, 1); // double, wire type 1
        writer.writeDouble(dataPoint.value);
    }
    // attributes (field 7, repeated KeyValue)
    if (dataPoint.attributes) {
        writeAttributes(writer, dataPoint.attributes, 7);
    }
    writer.finishLengthDelimited(start, writer.pos - startPos);
}
/**
 * Serialize a HistogramDataPoint directly from SDK DataPoint<Histogram>
 *
 * Proto fields (HistogramDataPoint):
 *   9  attributes               repeated KeyValue  (wire type 2)
 *   2  start_time_unix_nano     fixed64            (wire type 1)
 *   3  time_unix_nano           fixed64            (wire type 1)
 *   4  count                    fixed64            (wire type 1)
 *   5  sum                      optional double    (wire type 1)
 *   6  bucket_counts            repeated fixed64   (packed, wire type 2)
 *   7  explicit_bounds          repeated double    (packed, wire type 2)
 *   8  exemplars                repeated Exemplar  (wire type 2)
 *  10  flags                    uint32             (wire type 0)
 *  11  min                      optional double    (wire type 1)
 *  12  max                      optional double    (wire type 1)
 */
function serializeHistogramDataPoint(writer, dataPoint) {
    const start = writer.startLengthDelimited();
    const startPos = writer.pos;
    const histogram = dataPoint.value;
    // start_time_unix_nano (field 2, fixed64)
    writer.writeTag(2, 1);
    writeHrTimeAsFixed64(writer, dataPoint.startTime);
    // time_unix_nano (field 3, fixed64)
    writer.writeTag(3, 1);
    writeHrTimeAsFixed64(writer, dataPoint.endTime);
    // count (field 4, fixed64)
    writer.writeTag(4, 1);
    writer.writeFixed64(histogram.count >>> 0, (histogram.count / 0x100000000) >>> 0);
    // sum (field 5, optional double) - skip if undefined
    if (histogram.sum !== undefined) {
        writer.writeTag(5, 1);
        writer.writeDouble(histogram.sum);
    }
    // bucket_counts (field 6, repeated fixed64, packed)
    if (histogram.buckets.counts.length > 0) {
        writer.writeTag(6, 2);
        const countsStart = writer.startLengthDelimited();
        const countsStartPos = writer.pos;
        for (const count of histogram.buckets.counts) {
            writer.writeFixed64(count >>> 0, (count / 0x100000000) >>> 0);
        }
        writer.finishLengthDelimited(countsStart, writer.pos - countsStartPos);
    }
    // explicit_bounds (field 7, repeated double, packed)
    if (histogram.buckets.boundaries.length > 0) {
        writer.writeTag(7, 2);
        const boundsStart = writer.startLengthDelimited();
        const boundsStartPos = writer.pos;
        for (const bound of histogram.buckets.boundaries) {
            writer.writeDouble(bound);
        }
        writer.finishLengthDelimited(boundsStart, writer.pos - boundsStartPos);
    }
    // attributes (field 9, repeated KeyValue)
    if (dataPoint.attributes) {
        writeAttributes(writer, dataPoint.attributes, 9);
    }
    // min (field 11, optional double)
    if (histogram.min !== undefined) {
        writer.writeTag(11, 1);
        writer.writeDouble(histogram.min);
    }
    // max (field 12, optional double)
    if (histogram.max !== undefined) {
        writer.writeTag(12, 1);
        writer.writeDouble(histogram.max);
    }
    writer.finishLengthDelimited(start, writer.pos - startPos);
}
/**
 * Serialize ExponentialHistogramDataPoint.Buckets
 *
 * Proto fields (Buckets):
 *   1  offset         sint32           (wire type 0, zigzag)
 *   2  bucket_counts  repeated uint64  (packed, wire type 2)
 */
function serializeExponentialBuckets(writer, offset, bucketCounts) {
    const start = writer.startLengthDelimited();
    const startPos = writer.pos;
    // offset (field 1, sint32)
    if (offset !== 0) {
        writer.writeTag(1, 0);
        writer.writeSint32(offset);
    }
    // bucket_counts (field 2, repeated uint64, packed)
    if (bucketCounts.length > 0) {
        writer.writeTag(2, 2);
        const bcStart = writer.startLengthDelimited();
        const bcStartPos = writer.pos;
        for (const count of bucketCounts) {
            writer.writeVarint(count);
        }
        writer.finishLengthDelimited(bcStart, writer.pos - bcStartPos);
    }
    writer.finishLengthDelimited(start, writer.pos - startPos);
}
/**
 * Serialize an ExponentialHistogramDataPoint directly from SDK DataPoint<ExponentialHistogram>
 *
 * Proto fields (ExponentialHistogramDataPoint):
 *   1  attributes               repeated KeyValue  (wire type 2)
 *   2  start_time_unix_nano     fixed64            (wire type 1)
 *   3  time_unix_nano           fixed64            (wire type 1)
 *   4  count                    fixed64            (wire type 1)
 *   5  sum                      optional double    (wire type 1)
 *   6  scale                    sint32             (wire type 0, zigzag)
 *   7  zero_count               fixed64            (wire type 1)
 *   8  positive                 Buckets            (wire type 2)
 *   9  negative                 Buckets            (wire type 2)
 *  10  flags                    uint32             (wire type 0)
 *  11  exemplars                repeated Exemplar  (wire type 2)
 *  12  min                      optional double    (wire type 1)
 *  13  max                      optional double    (wire type 1)
 */
function serializeExponentialHistogramDataPoint(writer, dataPoint) {
    const start = writer.startLengthDelimited();
    const startPos = writer.pos;
    const histogram = dataPoint.value;
    // attributes (field 1, repeated KeyValue)
    if (dataPoint.attributes) {
        writeAttributes(writer, dataPoint.attributes, 1);
    }
    // start_time_unix_nano (field 2, fixed64)
    writer.writeTag(2, 1);
    writeHrTimeAsFixed64(writer, dataPoint.startTime);
    // time_unix_nano (field 3, fixed64)
    writer.writeTag(3, 1);
    writeHrTimeAsFixed64(writer, dataPoint.endTime);
    // count (field 4, fixed64)
    writer.writeTag(4, 1);
    writer.writeFixed64(histogram.count >>> 0, (histogram.count / 0x100000000) >>> 0);
    // sum (field 5, optional double) - skip if undefined
    if (histogram.sum !== undefined) {
        writer.writeTag(5, 1);
        writer.writeDouble(histogram.sum);
    }
    // scale (field 6, sint32)
    if (histogram.scale !== 0) {
        writer.writeTag(6, 0);
        writer.writeSint32(histogram.scale);
    }
    // zero_count (field 7, fixed64)
    writer.writeTag(7, 1);
    writer.writeFixed64(histogram.zeroCount >>> 0, (histogram.zeroCount / 0x100000000) >>> 0);
    // positive (field 8, Buckets)
    writer.writeTag(8, 2);
    serializeExponentialBuckets(writer, histogram.positive.offset, histogram.positive.bucketCounts);
    // negative (field 9, Buckets)
    writer.writeTag(9, 2);
    serializeExponentialBuckets(writer, histogram.negative.offset, histogram.negative.bucketCounts);
    // min (field 12, optional double)
    if (histogram.min !== undefined) {
        writer.writeTag(12, 1);
        writer.writeDouble(histogram.min);
    }
    // max (field 13, optional double)
    if (histogram.max !== undefined) {
        writer.writeTag(13, 1);
        writer.writeDouble(histogram.max);
    }
    writer.finishLengthDelimited(start, writer.pos - startPos);
}
/**
 * Serialize a Metric message with its data type
 *
 * Proto fields (Metric):
 *   1  name                     string             (wire type 2)
 *   2  description              string             (wire type 2)
 *   3  unit                     string             (wire type 2)
 *   5  gauge                    Gauge              (wire type 2)
 *   7  sum                      Sum                (wire type 2)
 *   9  histogram                Histogram          (wire type 2)
 *  10  exponential_histogram    ExponentialHist    (wire type 2)
 *  11  summary                  Summary            (wire type 2)
 */
function serializeMetric(writer, metricData) {
    const metricStart = writer.startLengthDelimited();
    const metricStartPos = writer.pos;
    // name (field 1, string)
    writer.writeTag(1, 2);
    writer.writeString(metricData.descriptor.name);
    // description (field 2, string) - skip if empty
    if (metricData.descriptor.description) {
        writer.writeTag(2, 2);
        writer.writeString(metricData.descriptor.description);
    }
    // unit (field 3, string) - skip if empty
    if (metricData.descriptor.unit) {
        writer.writeTag(3, 2);
        writer.writeString(metricData.descriptor.unit);
    }
    // data oneof - dispatch on DataPointType
    switch (metricData.dataPointType) {
        case DataPointType.GAUGE:
            writer.writeTag(5, 2); // gauge (field 5)
            serializeGauge(writer, metricData);
            break;
        case DataPointType.SUM:
            writer.writeTag(7, 2); // sum (field 7)
            serializeSum(writer, metricData);
            break;
        case DataPointType.HISTOGRAM:
            writer.writeTag(9, 2); // histogram (field 9)
            serializeHistogramMetric(writer, metricData);
            break;
        case DataPointType.EXPONENTIAL_HISTOGRAM:
            writer.writeTag(10, 2); // exponential_histogram (field 10)
            serializeExponentialHistogramMetric(writer, metricData);
            break;
        default: {
            // Compile-time exhaustiveness check: if a new DataPointType is added,
            // TypeScript will error here until the case is handled.
            const _exhaustive = metricData;
            void _exhaustive;
        }
    }
    writer.finishLengthDelimited(metricStart, writer.pos - metricStartPos);
}
/**
 * Proto fields (Gauge):
 *   1  data_points  repeated NumberDataPoint  (wire type 2)
 */
function serializeGauge(writer, metricData) {
    const start = writer.startLengthDelimited();
    const startPos = writer.pos;
    for (const dataPoint of metricData.dataPoints) {
        writer.writeTag(1, 2);
        serializeNumberDataPoint(writer, dataPoint, metricData.descriptor.valueType);
    }
    writer.finishLengthDelimited(start, writer.pos - startPos);
}
/**
 * Proto fields (Sum):
 *   1  data_points               repeated NumberDataPoint  (wire type 2)
 *   2  aggregation_temporality   AggregationTemporality    (wire type 0)
 *   3  is_monotonic              bool                      (wire type 0)
 */
function serializeSum(writer, metricData) {
    const start = writer.startLengthDelimited();
    const startPos = writer.pos;
    for (const dataPoint of metricData.dataPoints) {
        writer.writeTag(1, 2);
        serializeNumberDataPoint(writer, dataPoint, metricData.descriptor.valueType);
    }
    // aggregation_temporality (field 2, enum/varint)
    const temporality = toProtoAggregationTemporality(metricData.aggregationTemporality);
    if (temporality !== 0) {
        writer.writeTag(2, 0);
        writer.writeVarint(temporality);
    }
    // is_monotonic (field 3, bool)
    if (metricData.isMonotonic) {
        writer.writeTag(3, 0);
        writer.writeVarint(1);
    }
    writer.finishLengthDelimited(start, writer.pos - startPos);
}
/**
 * Proto fields (Histogram):
 *   1  data_points               repeated HistogramDataPoint  (wire type 2)
 *   2  aggregation_temporality   AggregationTemporality       (wire type 0)
 */
function serializeHistogramMetric(writer, metricData) {
    const start = writer.startLengthDelimited();
    const startPos = writer.pos;
    for (const dataPoint of metricData.dataPoints) {
        writer.writeTag(1, 2);
        serializeHistogramDataPoint(writer, dataPoint);
    }
    // aggregation_temporality (field 2, enum/varint)
    const temporality = toProtoAggregationTemporality(metricData.aggregationTemporality);
    if (temporality !== 0) {
        writer.writeTag(2, 0);
        writer.writeVarint(temporality);
    }
    writer.finishLengthDelimited(start, writer.pos - startPos);
}
/**
 * Proto fields (ExponentialHistogram):
 *   1  data_points               repeated ExponentialHistogramDataPoint  (wire type 2)
 *   2  aggregation_temporality   AggregationTemporality                 (wire type 0)
 */
function serializeExponentialHistogramMetric(writer, metricData) {
    const start = writer.startLengthDelimited();
    const startPos = writer.pos;
    for (const dataPoint of metricData.dataPoints) {
        writer.writeTag(1, 2);
        serializeExponentialHistogramDataPoint(writer, dataPoint);
    }
    // aggregation_temporality (field 2, enum/varint)
    const temporality = toProtoAggregationTemporality(metricData.aggregationTemporality);
    if (temporality !== 0) {
        writer.writeTag(2, 0);
        writer.writeVarint(temporality);
    }
    writer.finishLengthDelimited(start, writer.pos - startPos);
}
/**
 * Serialize ScopeMetrics directly from SDK types
 */
function serializeScopeMetrics(writer, scopeMetrics) {
    const scopeStart = writer.startLengthDelimited();
    const scopeStartPos = writer.pos;
    // scope (field 1, InstrumentationScope)
    writeInstrumentationScope(writer, scopeMetrics.scope, 1);
    // metrics (field 2, repeated Metric)
    for (const metric of scopeMetrics.metrics) {
        writer.writeTag(2, 2);
        serializeMetric(writer, metric);
    }
    // schema_url (field 3, string) - skip if empty
    if (scopeMetrics.scope.schemaUrl) {
        writer.writeTag(3, 2);
        writer.writeString(scopeMetrics.scope.schemaUrl);
    }
    writer.finishLengthDelimited(scopeStart, writer.pos - scopeStartPos);
}
/**
 * Serialize ResourceMetrics directly from SDK types
 *
 * Proto fields (ResourceMetrics):
 *   1  resource       Resource           (wire type 2)
 *   2  scope_metrics  repeated ScopeMetrics  (wire type 2)
 *   3  schema_url     string             (wire type 2)
 */
function serializeResourceMetrics(writer, resourceMetrics) {
    const start = writer.startLengthDelimited();
    const startPos = writer.pos;
    // resource (field 1, Resource)
    writeResource(writer, resourceMetrics.resource, 1);
    // scope_metrics (field 2, repeated ScopeMetrics)
    for (const scopeMetrics of resourceMetrics.scopeMetrics) {
        writer.writeTag(2, 2);
        serializeScopeMetrics(writer, scopeMetrics);
    }
    // schema_url (field 3, string) - skip if empty
    if (resourceMetrics.resource.schemaUrl) {
        writer.writeTag(3, 2);
        writer.writeString(resourceMetrics.resource.schemaUrl);
    }
    writer.finishLengthDelimited(start, writer.pos - startPos);
}
function toProtoAggregationTemporality(temporality) {
    switch (temporality) {
        case AggregationTemporality.DELTA:
            return 1;
        case AggregationTemporality.CUMULATIVE:
            return 2;
        default:
            return 0;
    }
}
/**
 * Serialize ExportMetricsServiceRequest directly from ResourceMetrics
 */
export function serializeMetricsExportRequest(resourceMetrics) {
    // First pass: estimate size
    const estimator = new ProtobufSizeEstimator();
    estimator.writeTag(1, 2);
    serializeResourceMetrics(estimator, resourceMetrics);
    // Second pass: write with estimated size
    const writer = new ProtobufWriter(estimator.pos);
    writer.writeTag(1, 2);
    serializeResourceMetrics(writer, resourceMetrics);
    return writer.finish();
}
//# sourceMappingURL=metrics-serializer.js.map