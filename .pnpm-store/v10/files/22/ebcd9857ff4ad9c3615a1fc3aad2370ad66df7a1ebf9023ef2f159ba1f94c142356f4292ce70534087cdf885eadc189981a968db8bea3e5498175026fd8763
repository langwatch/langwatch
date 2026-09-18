import { NormalizedSchema } from "@smithy/core/schema";
import type { Schema, ShapeSerializer } from "@smithy/types";
import { SerdeContextConfig } from "../../ConfigurableSerdeContext";
import type { JsonSettings } from "./JsonSettings";
/**
 * @deprecated prefer byte-targeting JsonShapeSerializer or its string adapter StringJsonShapeSerializer in codec-v2.
 * @public
 */
export declare class JsonShapeSerializer extends SerdeContextConfig implements ShapeSerializer<string> {
    readonly settings: JsonSettings;
    /**
     * Write buffer. Reused per value serialization pass.
     * In the initial implementation, this is not an incremental buffer.
     */
    protected buffer: any;
    protected useReplacer: boolean;
    protected rootSchema: NormalizedSchema | undefined;
    constructor(settings: JsonSettings);
    write(schema: Schema, value: unknown): void;
    flush(): string;
    /**
     * @internal
     */
    writeDiscriminatedDocument(schema: Schema, value: unknown): void;
    /**
     * Order if-statements by likelihood.
     */
    protected _write(schema: Schema, value: unknown, container?: NormalizedSchema): any;
}
