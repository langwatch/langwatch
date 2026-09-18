import { ProtobufWriter } from '../../common/protobuf/protobuf-writer';
import { hexToBinary } from '../../common/hex-to-binary';
import { writeInstrumentationScope, writeResource, writeAttributes, writeHrTimeAsFixed64, } from '../../common/protobuf/common-serializer';
import { ProtobufSizeEstimator } from '../../common/protobuf/protobuf-size-estimator';
// Span flags constants matching the OTLP specification
const SPAN_FLAGS_CONTEXT_HAS_IS_REMOTE_MASK = 0x100;
const SPAN_FLAGS_CONTEXT_IS_REMOTE_MASK = 0x200;
function buildSpanFlags(traceFlags, isRemote) {
    let flags = (traceFlags & 0xff) | SPAN_FLAGS_CONTEXT_HAS_IS_REMOTE_MASK;
    if (isRemote) {
        flags |= SPAN_FLAGS_CONTEXT_IS_REMOTE_MASK;
    }
    return flags;
}
/**
 * Serialize a Span.Status message
 *
 * Proto fields (Status):
 *   1  (reserved)
 *   2  message   string         (length-delimited)
 *   3  code      StatusCode     (varint)
 */
function serializeStatus(writer, status) {
    const statusStart = writer.startLengthDelimited();
    const statusStartPos = writer.pos;
    // message (field 2, string) - skip if empty
    if (status.message) {
        writer.writeTag(2, 2);
        writer.writeString(status.message);
    }
    // code (field 3, enum/varint) - always write as it defaults to UNSET (0) in proto
    writer.writeTag(3, 0);
    writer.writeVarint(status.code);
    writer.finishLengthDelimited(statusStart, writer.pos - statusStartPos);
}
/**
 * Serialize a Span.Event message
 *
 * Proto fields (Span.Event):
 *   1  time_unix_nano           fixed64            (wire type 1)
 *   2  name                     string             (wire type 2)
 *   3  attributes               repeated KeyValue  (wire type 2)
 *   4  dropped_attributes_count uint32             (wire type 0)
 */
function serializeEvent(writer, event) {
    const eventStart = writer.startLengthDelimited();
    const eventStartPos = writer.pos;
    // time_unix_nano (field 1, fixed64)
    writer.writeTag(1, 1);
    writeHrTimeAsFixed64(writer, event.time);
    // name (field 2, string)
    writer.writeTag(2, 2);
    writer.writeString(event.name);
    // attributes (field 3, repeated KeyValue)
    if (event.attributes) {
        writeAttributes(writer, event.attributes, 3);
    }
    // dropped_attributes_count (field 4, uint32)
    writer.writeTag(4, 0);
    writer.writeVarint(event.droppedAttributesCount || 0);
    writer.finishLengthDelimited(eventStart, writer.pos - eventStartPos);
}
/**
 * Serialize a Span.Link message
 *
 * Proto fields (Span.Link):
 *   1  trace_id                 bytes              (wire type 2)
 *   2  span_id                  bytes              (wire type 2)
 *   3  trace_state              string             (wire type 2)
 *   4  attributes               repeated KeyValue  (wire type 2)
 *   5  dropped_attributes_count uint32             (wire type 0)
 *   6  flags                    fixed32            (wire type 5)
 */
function serializeLink(writer, link) {
    const linkStart = writer.startLengthDelimited();
    const linkStartPos = writer.pos;
    const context = link.context;
    // trace_id (field 1, bytes)
    writer.writeTag(1, 2);
    writer.writeBytes(hexToBinary(context.traceId));
    // span_id (field 2, bytes)
    writer.writeTag(2, 2);
    writer.writeBytes(hexToBinary(context.spanId));
    // trace_state (field 3, string) - skip if empty
    const linkTraceState = context.traceState?.serialize();
    if (linkTraceState) {
        writer.writeTag(3, 2);
        writer.writeString(linkTraceState);
    }
    // attributes (field 4, repeated KeyValue)
    if (link.attributes) {
        writeAttributes(writer, link.attributes, 4);
    }
    // dropped_attributes_count (field 5, uint32)
    writer.writeTag(5, 0);
    writer.writeVarint(link.droppedAttributesCount || 0);
    // flags (field 6, fixed32)
    const linkFlags = buildSpanFlags(context.traceFlags, context.isRemote);
    if (linkFlags) {
        writer.writeTag(6, 5);
        writer.writeFixed32(linkFlags);
    }
    writer.finishLengthDelimited(linkStart, writer.pos - linkStartPos);
}
/**
 * Serialize a single Span message directly from ReadableSpan
 *
 * Proto fields (Span):
 *   1  trace_id                 bytes              (wire type 2)
 *   2  span_id                  bytes              (wire type 2)
 *   3  trace_state              string             (wire type 2)
 *   4  parent_span_id           bytes              (wire type 2)
 *   5  name                     string             (wire type 2)
 *   6  kind                     SpanKind           (wire type 0)
 *   7  start_time_unix_nano     fixed64            (wire type 1)
 *   8  end_time_unix_nano       fixed64            (wire type 1)
 *   9  attributes               repeated KeyValue  (wire type 2)
 *  10  dropped_attributes_count uint32             (wire type 0)
 *  11  events                   repeated Event     (wire type 2)
 *  12  dropped_events_count     uint32             (wire type 0)
 *  13  links                    repeated Link      (wire type 2)
 *  14  dropped_links_count      uint32             (wire type 0)
 *  15  status                   Status             (wire type 2)
 *  16  flags                    fixed32            (wire type 5)
 */
function serializeSpan(writer, span) {
    const spanStart = writer.startLengthDelimited();
    const spanStartPos = writer.pos;
    const ctx = span.spanContext();
    // trace_id (field 1, bytes)
    writer.writeTag(1, 2);
    writer.writeBytes(hexToBinary(ctx.traceId));
    // span_id (field 2, bytes)
    writer.writeTag(2, 2);
    writer.writeBytes(hexToBinary(ctx.spanId));
    // trace_state (field 3, string) - skip if empty
    const traceState = ctx.traceState?.serialize();
    if (traceState) {
        writer.writeTag(3, 2);
        writer.writeString(traceState);
    }
    // parent_span_id (field 4, bytes) - skip if empty
    if (span.parentSpanContext?.spanId) {
        writer.writeTag(4, 2);
        writer.writeBytes(hexToBinary(span.parentSpanContext.spanId));
    }
    // name (field 5, string)
    writer.writeTag(5, 2);
    writer.writeString(span.name);
    // kind (field 6, enum/varint)
    // Span kind is offset by 1: API does not define a value for unset
    const kind = span.kind == null ? 0 : span.kind + 1;
    if (kind !== 0) {
        writer.writeTag(6, 0);
        writer.writeVarint(kind);
    }
    // start_time_unix_nano (field 7, fixed64)
    writer.writeTag(7, 1);
    writeHrTimeAsFixed64(writer, span.startTime);
    // end_time_unix_nano (field 8, fixed64)
    writer.writeTag(8, 1);
    writeHrTimeAsFixed64(writer, span.endTime);
    // attributes (field 9, repeated KeyValue)
    if (span.attributes) {
        writeAttributes(writer, span.attributes, 9);
    }
    // dropped_attributes_count (field 10, uint32)
    writer.writeTag(10, 0);
    writer.writeVarint(span.droppedAttributesCount);
    // events (field 11, repeated Event)
    for (const event of span.events) {
        writer.writeTag(11, 2);
        serializeEvent(writer, event);
    }
    // dropped_events_count (field 12, uint32)
    writer.writeTag(12, 0);
    writer.writeVarint(span.droppedEventsCount);
    // links (field 13, repeated Link)
    for (const link of span.links) {
        writer.writeTag(13, 2);
        serializeLink(writer, link);
    }
    // dropped_links_count (field 14, uint32)
    writer.writeTag(14, 0);
    writer.writeVarint(span.droppedLinksCount);
    // status (field 15, Status)
    writer.writeTag(15, 2);
    serializeStatus(writer, span.status);
    // flags (field 16, fixed32)
    const flags = buildSpanFlags(ctx.traceFlags, span.parentSpanContext?.isRemote);
    if (flags) {
        writer.writeTag(16, 5);
        writer.writeFixed32(flags);
    }
    writer.finishLengthDelimited(spanStart, writer.pos - spanStartPos);
}
/**
 * Serialize ScopeSpans directly from SDK types
 */
function serializeScopeSpans(writer, scope, spans) {
    const scopeSpansStart = writer.startLengthDelimited();
    const scopeSpansStartPos = writer.pos;
    // scope (field 1, InstrumentationScope)
    writeInstrumentationScope(writer, scope, 1);
    // spans (field 2, repeated Span)
    for (const span of spans) {
        writer.writeTag(2, 2);
        serializeSpan(writer, span);
    }
    // schema_url (field 3, string) - skip if empty
    if (scope.schemaUrl) {
        writer.writeTag(3, 2);
        writer.writeString(scope.schemaUrl);
    }
    writer.finishLengthDelimited(scopeSpansStart, writer.pos - scopeSpansStartPos);
}
/**
 * Serialize ResourceSpans directly from SDK Resource type
 */
function serializeResourceSpans(writer, resource, scopeMap) {
    const resourceSpansStart = writer.startLengthDelimited();
    const resourceSpansStartPos = writer.pos;
    // resource (field 1, Resource)
    writeResource(writer, resource, 1);
    // scope_spans (field 2, repeated ScopeSpans)
    for (const scopeSpans of scopeMap.values()) {
        writer.writeTag(2, 2);
        const scope = scopeSpans[0].instrumentationScope;
        serializeScopeSpans(writer, scope, scopeSpans);
    }
    // schema_url (field 3, string) - skip if empty
    if (resource.schemaUrl) {
        writer.writeTag(3, 2);
        writer.writeString(resource.schemaUrl);
    }
    writer.finishLengthDelimited(resourceSpansStart, writer.pos - resourceSpansStartPos);
}
/**
 * Group spans by resource and instrumentation scope using identity comparison
 */
function createResourceMap(spans) {
    const resourceMap = new Map();
    for (const span of spans) {
        const resource = span.resource;
        const scope = span.instrumentationScope;
        let scopeMap = resourceMap.get(resource);
        if (!scopeMap) {
            scopeMap = new Map();
            resourceMap.set(resource, scopeMap);
        }
        let records = scopeMap.get(scope);
        if (!records) {
            records = [];
            scopeMap.set(scope, records);
        }
        records.push(span);
    }
    return resourceMap;
}
/**
 * Serialize ExportTraceServiceRequest directly from ReadableSpan[]
 */
export function serializeTraceExportRequest(spans) {
    const resourceMap = createResourceMap(spans);
    // First pass: estimate size
    const estimator = new ProtobufSizeEstimator();
    for (const [resource, scopeMap] of resourceMap) {
        estimator.writeTag(1, 2);
        serializeResourceSpans(estimator, resource, scopeMap);
    }
    // Second pass: write with estimated size
    const writer = new ProtobufWriter(estimator.pos);
    for (const [resource, scopeMap] of resourceMap) {
        writer.writeTag(1, 2);
        serializeResourceSpans(writer, resource, scopeMap);
    }
    return writer.finish();
}
//# sourceMappingURL=trace-serializer.js.map