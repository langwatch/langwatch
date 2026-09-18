import { EndpointParameterInstructions } from "@smithy/types";
import {
  CognitoIdentityClientResolvedConfig,
  ServiceInputTypes,
  ServiceOutputTypes,
} from "./CognitoIdentityClient";
export declare const command: <I extends ServiceInputTypes, O extends ServiceOutputTypes>(
  added: EndpointParameterInstructions,
  plugins: (
    CommandCtor: any,
    clientStack: any,
    config: any,
    options: any,
  ) => import("@smithy/types").Pluggable<any, any>[],
  op: string,
  $: import("@smithy/types").StaticOperationSchema,
  smithyContext?: Record<string, unknown>,
) => {
  new (
    input: I,
  ): import("@smithy/core/client").CommandImpl<
    I,
    O,
    CognitoIdentityClientResolvedConfig,
    ServiceInputTypes,
    ServiceOutputTypes
  >;
  new (
    ...[input]: import("@smithy/types").OptionalParameter<I>
  ): import("@smithy/core/client").CommandImpl<
    I,
    O,
    CognitoIdentityClientResolvedConfig,
    ServiceInputTypes,
    ServiceOutputTypes
  >;
  getEndpointParameterInstructions(): EndpointParameterInstructions;
};
export declare const _ep0: EndpointParameterInstructions;
export declare const _mw0: (Command: any, cs: any, config: any, o: any) => never[];
