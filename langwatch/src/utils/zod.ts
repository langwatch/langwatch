import {
  type ZodRawShape,
  type UnknownKeysParam,
  ZodObject,
  type ZodTypeAny,
  ZodArray,
  ZodOptional,
  ZodNullable,
  ZodTuple,
  type ZodTupleItems,
} from "zod";
import type { errorUtil } from "zod/lib/helpers/errorUtil";

type ZodObjectMapper<T extends ZodRawShape, U extends UnknownKeysParam> = (
  o: ZodObject<T>
) => ZodObject<T, U>;

function deepApplyObject(
  schema: ZodTypeAny,
  map: ZodObjectMapper<any, any>
): any {
  if (schema instanceof ZodObject) {
    const newShape: Record<string, ZodTypeAny> = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = deepApplyObject(fieldSchema, map);
    }
    const newObject = new ZodObject({
      ...schema._def,
      shape: () => newShape,
    });
    return map(newObject);
  } else if (schema instanceof ZodArray) {
    return ZodArray.create(deepApplyObject(schema.element, map));
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepApplyObject(schema.unwrap(), map));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepApplyObject(schema.unwrap(), map));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(
      schema.items.map((item: any) => deepApplyObject(item, map))
    );
  } else {
    return schema;
  }
}

type DeepUnknownKeys<
  T extends ZodTypeAny,
  UnknownKeys extends UnknownKeysParam,
> = T extends ZodObject<infer Shape, infer _, infer Catchall>
  ? ZodObject<
      {
        [k in keyof Shape]: DeepUnknownKeys<Shape[k], UnknownKeys>;
      },
      UnknownKeys,
      Catchall
    >
  : T extends ZodArray<infer Type, infer Card>
  ? ZodArray<DeepUnknownKeys<Type, UnknownKeys>, Card>
  : T extends ZodOptional<infer Type>
  ? ZodOptional<DeepUnknownKeys<Type, UnknownKeys>>
  : T extends ZodNullable<infer Type>
  ? ZodNullable<DeepUnknownKeys<Type, UnknownKeys>>
  : T extends ZodTuple<infer Items>
  ? {
      [k in keyof Items]: Items[k] extends ZodTypeAny
        ? DeepUnknownKeys<Items[k], UnknownKeys>
        : never;
    } extends infer PI
    ? PI extends ZodTupleItems
      ? ZodTuple<PI>
      : never
    : never
  : T;

type DeepPassthrough<T extends ZodTypeAny> = DeepUnknownKeys<T, "passthrough">;
export function deepPassthrough<T extends ZodTypeAny>(
  schema: T
): DeepPassthrough<T> {
  return deepApplyObject(schema, (s) => s.passthrough()) as DeepPassthrough<T>;
}

type DeepStrip<T extends ZodTypeAny> = DeepUnknownKeys<T, "strip">;
export function deepStrip<T extends ZodTypeAny>(schema: T): DeepStrip<T> {
  return deepApplyObject(schema, (s) => s.strip()) as DeepStrip<T>;
}

type DeepStrict<T extends ZodTypeAny> = DeepUnknownKeys<T, "strict">;
export function deepStrict<T extends ZodTypeAny>(
  schema: T,
  error?: errorUtil.ErrMessage
): DeepStrict<T> {
  return deepApplyObject(schema, (s) => s.strict(error)) as DeepStrict<T>;
}
