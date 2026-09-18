import { EndpointParameterInstructions } from "@smithy/types";
import { ServiceInputTypes, ServiceOutputTypes, STSClientResolvedConfig } from "./STSClient";
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
    STSClientResolvedConfig,
    ServiceInputTypes,
    ServiceOutputTypes
  >;
  new (
    ...[input]: import("@smithy/types").OptionalParameter<I>
  ): import("@smithy/core/client").CommandImpl<
    I,
    O,
    STSClientResolvedConfig,
    ServiceInputTypes,
    ServiceOutputTypes
  >;
  getEndpointParameterInstructions(): EndpointParameterInstructions;
};
export declare const _ep0: EndpointParameterInstructions;
export declare const _mw0: (Command: any, cs: any, config: any, o: any) => never[];
