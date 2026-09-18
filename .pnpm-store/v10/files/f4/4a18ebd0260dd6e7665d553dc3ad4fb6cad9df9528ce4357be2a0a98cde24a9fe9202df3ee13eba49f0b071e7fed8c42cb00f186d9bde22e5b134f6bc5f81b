import { ENV_DEFS } from './EnvDefinition';
/** Base definition shared by all env var types. */
interface EnvVarBase<T> {
    key: string;
    description: string;
    defaultValue?: T;
}
export interface StringEnvVar extends EnvVarBase<string> {
    type: 'string';
    allowedValues?: readonly string[];
}
export interface BooleanEnvVar extends EnvVarBase<boolean> {
    type: 'boolean';
    defaultValue: boolean;
}
export type EnvVarDefinition = StringEnvVar | BooleanEnvVar;
type ResolvedType<D extends EnvVarDefinition> = D extends StringEnvVar ? string | undefined : D extends BooleanEnvVar ? boolean : never;
export declare function readEnvVar<D extends EnvVarDefinition>(def: D): ResolvedType<D>;
export type EnvValues = {
    [K in keyof typeof ENV_DEFS]: ResolvedType<(typeof ENV_DEFS)[K]>;
};
export declare function readAllEnvVars(): EnvValues;
export {};
//# sourceMappingURL=EnvReader.d.ts.map