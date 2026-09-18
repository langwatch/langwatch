import { EndpointParameterInstructions } from "@smithy/types";
import { SSOClientResolvedConfig } from "./SSOClient";
export declare const command: <
  I extends import("./commands").GetRoleCredentialsCommandInput,
  O extends import("./commands").GetRoleCredentialsCommandOutput,
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
    SSOClientResolvedConfig,
    import("./commands").GetRoleCredentialsCommandInput,
    import("./commands").GetRoleCredentialsCommandOutput
  >;
  new (
    ...[input]: import("@smithy/types").OptionalParameter<I>
  ): import("@smithy/core/client").CommandImpl<
    I,
    O,
    SSOClientResolvedConfig,
    import("./commands").GetRoleCredentialsCommandInput,
    import("./commands").GetRoleCredentialsCommandOutput
  >;
  getEndpointParameterInstructions(): EndpointParameterInstructions;
};
export declare const _ep0: EndpointParameterInstructions;
export declare const _mw0: (Command: any, cs: any, config: any, o: any) => never[];
