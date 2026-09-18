"use strict";
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.deserializeExportLogsServiceResponse = void 0;
const protobuf_reader_1 = require("../../common/protobuf/protobuf-reader");
/**
 * Parse an ExportLogsPartialSuccess embedded message from raw bytes.
 *
 * Field map (opentelemetry/proto/collector/logs/v1/logs_service.proto):
 *   1  rejected_log_records  int64   (varint)
 *   2  error_message         string  (length-delimited)
 */
function deserializePartialSuccess(data) {
    const reader = new protobuf_reader_1.ProtobufReader(data);
    const result = {};
    while (!reader.isAtEnd()) {
        const { fieldNumber, wireType } = reader.readTag();
        switch (fieldNumber) {
            case 1: // rejected_log_records (int64, varint)
                // expected wire type 0 (varint)
                if (wireType === 0) {
                    result.rejectedLogRecords = reader.readVarint();
                }
                else {
                    // unexpected wire type for this field; skip it safely
                    reader.skip(wireType);
                }
                break;
            case 2: // error_message (string, length-delimited)
                // expected wire type 2 (length-delimited)
                if (wireType === 2) {
                    result.errorMessage = reader.readString();
                }
                else {
                    // unexpected wire type for this field; skip it safely
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
 * Parse an ExportLogsServiceResponse protobuf message from raw bytes.
 *
 * Field map (opentelemetry/proto/collector/logs/v1/logs_service.proto):
 *   1  partial_success  ExportLogsPartialSuccess  (length-delimited)
 */
function deserializeExportLogsServiceResponse(data) {
    const reader = new protobuf_reader_1.ProtobufReader(data);
    const result = {};
    while (!reader.isAtEnd()) {
        const { fieldNumber, wireType } = reader.readTag();
        switch (fieldNumber) {
            case 1: // partial_success (ExportLogsPartialSuccess, length-delimited)
                // expected wire type 2 (length-delimited / embedded message)
                if (wireType === 2) {
                    result.partialSuccess = deserializePartialSuccess(reader.readBytes());
                }
                else {
                    // unexpected wire type for this field; skip it safely
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
exports.deserializeExportLogsServiceResponse = deserializeExportLogsServiceResponse;
//# sourceMappingURL=response-deserializer.js.map