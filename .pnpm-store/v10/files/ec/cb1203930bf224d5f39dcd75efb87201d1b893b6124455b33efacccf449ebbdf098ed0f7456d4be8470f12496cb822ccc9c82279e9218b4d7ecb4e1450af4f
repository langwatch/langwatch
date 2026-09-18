import { EndpointParameterInstructions } from "@smithy/types";
import { SSOOIDCClientResolvedConfig } from "./SSOOIDCClient";
export declare const command: <
  I extends import("./commands").CreateTokenCommandInput,
  O extends import("./commands").CreateTokenCommandOutput,
>(
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
    SSOOIDCClientResolvedConfig,
    import("./commands").CreateTokenCommandInput,
    import("./commands").CreateTokenCommandOutput
  >;
  new (
    ...[input]: import("@smithy/types").OptionalParameter<I>
  ): import("@smithy/core/client").CommandImpl<
    I,
    O,
    SSOOIDCClientResolvedConfig,
    import("./commands").CreateTokenCommandInput,
    import("./commands").CreateTokenCommandOutput
  >;
  getEndpointParameterInstructions(): EndpointParameterInstructions;
};
export declare const _ep0: EndpointParameterInstructions;
export declare const _mw0: (Command: any, cs: any, config: any, o: any) => never[];
