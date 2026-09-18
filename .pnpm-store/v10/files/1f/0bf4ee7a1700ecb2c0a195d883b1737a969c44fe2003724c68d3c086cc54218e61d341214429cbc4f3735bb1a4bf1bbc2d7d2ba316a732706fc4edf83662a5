import type { HttpResponse, Schema, SerdeFunctions } from "@smithy/types";
/**
 * @deprecated new calls to parseJsonBody must pass schema.
 * @internal
 */
export declare function parseJsonBody(streamBody: any, context: SerdeFunctions): Promise<any>;
/**
 * @internal
 */
export declare function parseJsonBody(streamBody: any, context: SerdeFunctions, schema: Schema): Promise<any>;
/**
 * @internal
 */
export declare const parseJsonErrorBody: (errorBody: any, context: SerdeFunctions) => Promise<any>;
/**
 * @internal
 */
export declare const loadRestJsonErrorCode: (output: HttpResponse, data: any) => string | undefined;
/**
 * @internal
 */
export declare const loadJsonRpcErrorCode: (output: HttpResponse, data: any, queryCompat?: boolean) => string | undefined;
