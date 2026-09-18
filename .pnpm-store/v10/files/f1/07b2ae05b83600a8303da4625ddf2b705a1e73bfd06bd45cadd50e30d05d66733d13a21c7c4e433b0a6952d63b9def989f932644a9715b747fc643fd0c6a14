import { $ShapeSerializer, $Codec, $ShapeDeserializer } from "@smithy/types";
import { SerdeContextConfig } from "../../ConfigurableSerdeContext";
import { JsonSettings } from "../JsonSettings";
export declare class JsonCodec2 extends SerdeContextConfig implements $Codec<Uint8Array, string> {
  readonly settings: JsonSettings;
  constructor(settings: JsonSettings);
  createSerializer(): $ShapeSerializer<Uint8Array>;
  createDeserializer(): $ShapeDeserializer<string>;
}
