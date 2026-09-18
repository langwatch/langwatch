"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.deserializeExportTraceServiceResponse = void 0;
const protobuf_reader_1 = require("../../common/protobuf/protobuf-reader");
/**
 * Parse an ExportTracePartialSuccess embedded message from raw bytes.
 *
 * Field map (opentelemetry/proto/collector/trace/v1/trace_service.proto):
 *   1  rejected_spans   int64   (varint)
 *   2  error_message    string  (length-delimited)
 */
function deserializePartialSuccess(data) {
    const reader = new protobuf_reader_1.ProtobufReader(data);
    const result = {};
    while (!reader.isAtEnd()) {
        const { fieldNumber, wireType } = reader.readTag();
        switch (fieldNumber) {
            case 1: // rejected_spans (int64, varint)
                if (wireType === 0) {
                    result.rejectedSpans = reader.readVarint();
                }
                else {
                    reader.skip(wireType);
                }
                break;
            case 2: // error_message (string, length-delimited)
                if (wireType === 2) {
                    result.errorMessage = reader.readString();
                }
                else {
                    reader.skip(wireType);
                }
                break;
            default:
                reader.skip(wireType);
                break;
        }
    }
    return result;
}
/**
 * Parse an ExportTraceServiceResponse protobuf message from raw bytes.
 *
 * Field map (opentelemetry/proto/collector/trace/v1/trace_service.proto):
 *   1  partial_success  ExportTracePartialSuccess  (length-delimited)
 */
function deserializeExportTraceServiceResponse(data) {
    const reader = new protobuf_reader_1.ProtobufReader(data);
    const result = {};
    while (!reader.isAtEnd()) {
        const { fieldNumber, wireType } = reader.readTag();
        switch (fieldNumber) {
            case 1: // partial_success (ExportTracePartialSuccess, length-delimited)
                if (wireType === 2) {
                    result.partialSuccess = deserializePartialSuccess(reader.readBytes());
                }
                else {
                    reader.skip(wireType);
                }
                break;
            default:
                reader.skip(wireType);
                break;
        }
    }
    return result;
}
exports.deserializeExportTraceServiceResponse = deserializeExportTraceServiceResponse;
//# sourceMappingURL=response-deserializer.js.map