import { NormalizedSchema } from "@smithy/core/schema";
import { Schema, ShapeSerializer } from "@smithy/types";
import { SerdeContextConfig } from "../../ConfigurableSerdeContext";
import { JsonSettings } from "./JsonSettings";
export declare class JsonShapeSerializer
  extends SerdeContextConfig
  implements ShapeSerializer<string>
{
  readonly settings: JsonSettings;
  protected buffer: any;
  protected useReplacer: boolean;
  protected rootSchema: NormalizedSchema | undefined;
  constructor(settings: JsonSettings);
  write(schema: Schema, value: unknown): void;
  flush(): string;
  writeDiscriminatedDocument(schema: Schema, value: unknown): void;
  protected _write(schema: Schema, value: unknown, container?: NormalizedSchema): any;
}
