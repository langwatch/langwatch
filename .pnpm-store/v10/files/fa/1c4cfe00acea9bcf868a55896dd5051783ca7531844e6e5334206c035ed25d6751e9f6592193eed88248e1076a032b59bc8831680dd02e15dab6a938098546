import type { Command } from "./command";
import type { MiddlewareStack } from "./middleware";
import type { MetadataBearer } from "./response";
import type { OptionalParameter } from "./util";
/**
 * A type which checks if the client configuration is optional.
 * If all entries of the client configuration are optional, it allows client creation without passing any config.
 *
 * @public
 */
export type CheckOptionalClientConfig<T> = OptionalParameter<T>;
/**
 * function definition for different overrides of client's 'send' function.
 *
 * @public
 */
export interface InvokeFunction<InputTypes extends object, OutputTypes extends MetadataBearer, ResolvedClientConfiguration> {
    <InputType extends InputTypes, OutputType extends OutputTypes>(command: Command<InputTypes, InputType, OutputTypes, OutputType, ResolvedClientConfiguration>, options?: any): Promise<OutputType>;
    <InputType extends InputTypes, OutputType extends OutputTypes>(command: Command<InputTypes, InputType, OutputTypes, OutputType, ResolvedClientConfiguration>, cb: (err: any, data?: OutputType) => void): void;
    <InputType extends InputTypes, OutputType extends OutputTypes>(command: Command<InputTypes, InputType, OutputTypes, OutputType, ResolvedClientConfiguration>, options: any, cb: (err: any, data?: OutputType) => void): void;
    <InputType extends InputTypes, OutputType extends OutputTypes>(command: Command<InputTypes, InputType, OutputTypes, OutputType, ResolvedClientConfiguration>, options?: any, cb?: (err: any, data?: OutputType) => void): Promise<OutputType> | void;
}
/**
 * Signature that appears on aggregated clients' methods.
 *
 * @public
 */
export interface InvokeMethod<InputType extends object, OutputType extends MetadataBearer> {
    (input: InputType, options?: any): Promise<OutputType>;
    (input: InputType, cb: (err: any, data?: OutputType) => void): void;
    (input: InputType, options: any, cb: (err: any, data?: OutputType) => void): void;
    (input: InputType, options?: any, cb?: (err: any, data?: OutputType) => void): Promise<OutputType> | void;
}
/**
 * Signature that appears on aggregated clients' methods when argument is optional.
 *
 * @public
 */
export interface InvokeMethodOptionalArgs<InputType extends object, OutputType extends MetadataBearer> {
    (): Promise<OutputType>;
    (input: InputType, options?: any): Promise<OutputType>;
    (input: InputType, cb: (err: any, data?: OutputType) => void): void;
    (input: InputType, options: any, cb: (err: any, data?: OutputType) => void): void;
    (input: InputType, options?: any, cb?: (err: any, data?: OutputType) => void): Promise<OutputType> | void;
}
/**
 * A general interface for service clients, idempotent to browser or node clients
 * This type corresponds to SmithyClient(https://github.com/aws/aws-sdk-js-v3/blob/main/packages/smithy-client/src/client.ts).
 * It's provided for using without importing the SmithyClient class.
 * @internal
 */
export interface Client<Input extends object, Output extends MetadataBearer, ResolvedClientConfiguration> {
    readonly config: ResolvedClientConfiguration;
    middlewareStack: MiddlewareStack<Input, Output>;
    send: InvokeFunction<Input, Output, ResolvedClientConfiguration>;
    destroy: () => void;
}
