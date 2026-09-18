import type { DocumentType, Schema, ShapeDeserializer } from "@smithy/types";
import { SerdeContextConfig } from "../../ConfigurableSerdeContext";
import type { JsonSettings } from "../JsonSettings";
/**
 * Performance-optimized JSON deserializer.
 *
 * Skips UTF-8 decoding when the runtime supports JSON.parse(Buffer) (Node 22+).
 *
 * After JSON.parse, lists, maps, and document containers are mutated in place
 * (element values are overwritten with their deserialized form) rather than
 * copied into new arrays/objects. Structs allocate a fresh object because
 * jsonName traits require key renaming, and building the output object
 * incrementally lets V8 assign a stable hidden class rather than
 * deoptimizing from repeated property deletion/addition on an existing shape.
 *
 * In-place mutation is safe here because the parsed tree is locally owned
 * after JSON.parse with no external references, so rewriting values avoids
 * redundant allocation and GC pressure.
 *
 * @public
 */
export declare class JsonShapeDeserializer2 extends SerdeContextConfig implements ShapeDeserializer<string> {
    readonly settings: JsonSettings;
    constructor(settings: JsonSettings);
    read(schema: Schema, data: string | Uint8Array | unknown): Promise<any>;
    readObject(schema: Schema, data: DocumentType): any;
    protected _read(schema: Schema, value: unknown): any;
    private _readStruct;
    private needsTransform;
}
