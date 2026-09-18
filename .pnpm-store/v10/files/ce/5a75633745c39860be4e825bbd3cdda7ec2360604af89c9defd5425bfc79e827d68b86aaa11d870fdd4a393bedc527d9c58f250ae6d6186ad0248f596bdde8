import type { Codec } from "@smithy/types";
import { SerdeContextConfig } from "../../ConfigurableSerdeContext";
import { JsonShapeDeserializer } from "./JsonShapeDeserializer";
import { JsonShapeSerializer } from "./JsonShapeSerializer";
import type { JsonSettings } from "./JsonSettings";
/**
 * @deprecated use JsonCodec2.
 * @public
 */
export declare class JsonCodec extends SerdeContextConfig implements Codec<string, string> {
    readonly settings: JsonSettings;
    constructor(settings: JsonSettings);
    createSerializer(): JsonShapeSerializer;
    createDeserializer(): JsonShapeDeserializer;
}
