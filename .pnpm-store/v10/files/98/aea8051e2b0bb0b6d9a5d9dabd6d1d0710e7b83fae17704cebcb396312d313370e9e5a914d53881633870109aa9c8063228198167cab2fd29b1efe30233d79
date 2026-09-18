import { NormalizedSchema } from "@smithy/core/schema";
import { Schema, ShapeSerializer } from "@smithy/types";
import { SerdeContextConfig } from "../../ConfigurableSerdeContext";
import { JsonSettings } from "../JsonSettings";
export declare class JsonShapeSerializer2
  extends SerdeContextConfig
  implements ShapeSerializer<Uint8Array>
{
  readonly settings: JsonSettings;
  private json;
  private i;
  private rootSchema;
  private rawValue;
  private passthrough;
  constructor(settings: JsonSettings);
  write(schema: Schema, value: unknown): void;
  writeDiscriminatedDocument(schema: Schema, value: unknown): void;
  flush(): Uint8Array;
  protected ensure(byteCount: number): void;
  protected writeAscii(s: string): void;
  protected writeAsciiQuoted(s: string): void;
  protected writeJsonString(s: string): void;
  protected writeUnicodeEscape(code: number): void;
  protected static readonly B64: Uint8Array;
  protected writeBase64(data: Uint8Array): void;
  protected writeValue(
    schema: Schema,
    value: unknown,
    container: NormalizedSchema | undefined,
  ): void;
  protected writeStruct(ns: NormalizedSchema, value: Record<string, unknown>): void;
  protected writeList(ns: NormalizedSchema, value: unknown[], isDocument?: boolean): void;
  protected writeMap(
    ns: NormalizedSchema,
    value: Record<string, unknown>,
    isDocument?: boolean,
  ): void;
  protected writeTimestamp(ns: NormalizedSchema, value: Date): void;
}
