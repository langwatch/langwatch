"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createExportLogsServiceRequest = void 0;
const internal_1 = require("../common/internal");
function createExportLogsServiceRequest(logRecords, encoder) {
    return {
        resourceLogs: logRecordsToResourceLogs(logRecords, encoder),
    };
}
exports.createExportLogsServiceRequest = createExportLogsServiceRequest;
function createResourceMap(logRecords) {
    const resourceMap = new Map();
    for (const record of logRecords) {
        const { resource, instrumentationScope } = record;
        let ismMap = resourceMap.get(resource);
        if (!ismMap) {
            ismMap = new Map();
            resourceMap.set(resource, ismMap);
        }
        let records = ismMap.get(instrumentationScope);
        if (!records) {
            records = [];
            ismMap.set(instrumentationScope, records);
        }
        records.push(record);
    }
    return resourceMap;
}
function logRecordsToResourceLogs(logRecords, encoder) {
    const resourceMap = createResourceMap(logRecords);
    return Array.from(resourceMap, ([resource, ismMap]) => {
        const processedResource = (0, internal_1.createResource)(resource, encoder);
        return {
            resource: processedResource,
            scopeLogs: Array.from(ismMap, ([, scopeLogs]) => {
                return {
                    scope: (0, internal_1.createInstrumentationScope)(scopeLogs[0].instrumentationScope, encoder),
                    logRecords: scopeLogs.map(log => toLogRecord(log, encoder)),
                    schemaUrl: scopeLogs[0].instrumentationScope.schemaUrl,
                };
            }),
            schemaUrl: processedResource.schemaUrl,
        };
    });
}
function toLogRecord(log, encoder) {
    return {
        timeUnixNano: encoder.encodeHrTime(log.hrTime),
        observedTimeUnixNano: encoder.encodeHrTime(log.hrTimeObserved),
        severityNumber: toSeverityNumber(log.severityNumber),
        severityText: log.severityText,
        body: (0, internal_1.toAnyValue)(log.body, encoder),
        eventName: log.eventName,
        attributes: (0, internal_1.toAttributes)(log.attributes, encoder),
        droppedAttributesCount: log.droppedAttributesCount,
        flags: log.spanContext?.traceFlags,
        traceId: encoder.encodeOptionalSpanContext(log.spanContext?.traceId),
        spanId: encoder.encodeOptionalSpanContext(log.spanContext?.spanId),
    };
}
function toSeverityNumber(severityNumber) {
    return severityNumber;
}
//# sourceMappingURL=internal.js.map