"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.deserializeExportMetricsServiceResponse = void 0;
const protobuf_reader_1 = require("../../common/protobuf/protobuf-reader");
/**
 * Parse an ExportMetricsPartialSuccess embedded message from raw bytes.
 *
 * Field map (opentelemetry/proto/collector/metrics/v1/metrics_service.proto):
 *   1  rejected_data_points  int64   (varint)
 *   2  error_message         string  (length-delimited)
 */
function deserializePartialSuccess(data) {
    const reader = new protobuf_reader_1.ProtobufReader(data);
    const result = {};
    while (!reader.isAtEnd()) {
        const { fieldNumber, wireType } = reader.readTag();
        switch (fieldNumber) {
            case 1: // rejected_data_points (int64, varint)
                if (wireType === 0) {
                    result.rejectedDataPoints = reader.readVarint();
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
 * Parse an ExportMetricsServiceResponse protobuf message from raw bytes.
 *
 * Field map (opentelemetry/proto/collector/metrics/v1/metrics_service.proto):
 *   1  partial_success  ExportMetricsPartialSuccess  (length-delimited)
 */
function deserializeExportMetricsServiceResponse(data) {
    const reader = new protobuf_reader_1.ProtobufReader(data);
    const result = {};
    while (!reader.isAtEnd()) {
        const { fieldNumber, wireType } = reader.readTag();
        switch (fieldNumber) {
            case 1: // partial_success (ExportMetricsPartialSuccess, length-delimited)
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
exports.deserializeExportMetricsServiceResponse = deserializeExportMetricsServiceResponse;
//# sourceMappingURL=response-deserializer.js.map