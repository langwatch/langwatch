import { HttpResponse, Schema, SerdeFunctions } from "@smithy/types";
export declare function parseJsonBody(streamBody: any, context: SerdeFunctions): Promise<any>;
export declare function parseJsonBody(
  streamBody: any,
  context: SerdeFunctions,
  schema: Schema,
): Promise<any>;
export declare const parseJsonErrorBody: (errorBody: any, context: SerdeFunctions) => Promise<any>;
export declare const loadRestJsonErrorCode: (output: HttpResponse, data: any) => string | undefined;
export declare const loadJsonRpcErrorCode: (
  output: HttpResponse,
  data: any,
  queryCompat?: boolean,
) => string | undefined;
