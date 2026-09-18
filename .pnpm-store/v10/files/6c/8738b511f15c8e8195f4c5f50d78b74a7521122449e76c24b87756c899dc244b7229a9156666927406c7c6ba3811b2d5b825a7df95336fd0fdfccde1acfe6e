import { NormalizedSchema } from "@smithy/core/schema";
import type { Schema, ShapeSerializer } from "@smithy/types";
import { SerdeContextConfig } from "../../ConfigurableSerdeContext";
import type { JsonSettings } from "../JsonSettings";
/**
 * Single-pass JSON serializer that writes directly to a Uint8Array buffer.
 * Fewer intermediate states as when compared to the initial multi-pass implementation.
 *
 * @public
 */
export declare class JsonShapeSerializer2 extends SerdeContextConfig implements ShapeSerializer<Uint8Array> {
    readonly settings: JsonSettings;
    private json;
    private i;
    private rootSchema;
    private rawValue;
    private passthrough;
    constructor(settings: JsonSettings);
    write(schema: Schema, value: unknown): void;
    /**
     * @internal
     */
    writeDiscriminatedDocument(schema: Schema, value: unknown): void;
    /**
     * Returns the serialized JSON as a Uint8Array (UTF-8 bytes).
     * This is the primary output — pass directly to request.body.
     */
    flush(): Uint8Array;
    protected ensure(byteCount: number): void;
    /**
     * Write a raw ASCII string (no JSON escaping). Used for pre-validated content
     * like numeric literals and pre-encoded base64.
     */
    protected writeAscii(s: string): void;
    /**
     * Write a quoted ASCII string with no escape checking.
     * Used for struct member keys (jsonName or model names) which are
     * guaranteed to be safe ASCII identifiers. No control chars, quotes,
     * backslashes, or non-ASCII.
     * Ensures extra room for surrounding structural chars (comma, colon).
     */
    protected writeAsciiQuoted(s: string): void;
    /**
     * Write a JSON-escaped string including the surrounding quotes.
     * Fast-path for ASCII, falls back to TextEncoder for multi-byte.
     */
    protected writeJsonString(s: string): void;
    protected writeUnicodeEscape(code: number): void;
    protected static readonly B64: Uint8Array;
    /**
     * Write a Uint8Array as a quoted base64 string directly into the buffer.
     * No intermediate JS string, no escape checking (base64 alphabet is safe ASCII).
     */
    protected writeBase64(data: Uint8Array): void;
    protected writeValue(schema: Schema, value: unknown, container: NormalizedSchema | undefined): void;
    protected writeStruct(ns: NormalizedSchema, value: Record<string, unknown>): void;
    protected writeList(ns: NormalizedSchema, value: unknown[], isDocument?: boolean): void;
    protected writeMap(ns: NormalizedSchema, value: Record<string, unknown>, isDocument?: boolean): void;
    protected writeTimestamp(ns: NormalizedSchema, value: Date): void;
}
