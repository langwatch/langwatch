import type { ZodObject as ZodObjectV3, ZodTypeAny } from 'zod';
import type { ZodObject as ZodObjectV4, ZodType as ZodTypeV4 } from 'zod/v4';
type ZodDefinition = Record<string, unknown> | undefined;
type ZodTypeV4Any = ZodTypeV4<any, any, any>;
export type ZodTypeLike = ZodTypeAny | ZodTypeV4Any;
export type ZodObjectLike = ZodObjectV3<any, any, any, any, any> | ZodObjectV4<any, any>;
export declare function asZodType(schema: ZodTypeLike): ZodTypeAny;
export declare function readZodDefinition(input: unknown): ZodDefinition;
export declare function readZodType(input: unknown): string | undefined;
export type ZodInfer<T extends ZodTypeLike> = T extends {
    _output: infer Output;
} ? Output : never;
export {};
