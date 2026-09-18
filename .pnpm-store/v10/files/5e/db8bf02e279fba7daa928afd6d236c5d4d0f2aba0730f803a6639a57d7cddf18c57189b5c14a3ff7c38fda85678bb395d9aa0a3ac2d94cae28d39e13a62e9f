import { Codec } from "@smithy/types";
import { SerdeContextConfig } from "../../ConfigurableSerdeContext";
import { JsonShapeDeserializer } from "./JsonShapeDeserializer";
import { JsonShapeSerializer } from "./JsonShapeSerializer";
import { JsonSettings } from "./JsonSettings";
export declare class JsonCodec extends SerdeContextConfig implements Codec<string, string> {
  readonly settings: JsonSettings;
  constructor(settings: JsonSettings);
  createSerializer(): JsonShapeSerializer;
  createDeserializer(): JsonShapeDeserializer;
}
