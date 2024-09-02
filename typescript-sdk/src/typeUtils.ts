import {
  reservedSpanParamsSchema,
  reservedTraceMetadataSchema
} from "./server/types/tracer.generated";

export type Strict<T> = T & { [K in Exclude<keyof any, keyof T>]: never };

type SnakeToCamelCase<S extends string> = S extends `${infer T}_${infer U}`
  ? `${T}${Capitalize<SnakeToCamelCase<U>>}`
  : S;

export type SnakeToCamelCaseNested<T> = T extends object
  ? T extends (infer U)[]
    ? U extends object
      ? {
          [K in keyof U as SnakeToCamelCase<
            K & string
          >]: SnakeToCamelCaseNested<U[K]>;
        }[]
      : T
    : {
        [K in keyof T as SnakeToCamelCase<K & string>]: SnakeToCamelCaseNested<
          T[K]
        >;
      }
  : T;

type CamelToSnakeCase<S extends string> = S extends `${infer T}${infer U}`
  ? `${T extends Capitalize<T> ? "_" : ""}${Lowercase<T>}${CamelToSnakeCase<U>}`
  : S;

export type CamelToSnakeCaseNested<T> = T extends object
  ? T extends (infer U)[]
    ? U extends object
      ? {
          [K in keyof U as CamelToSnakeCase<
            K & string
          >]: CamelToSnakeCaseNested<U[K]>;
        }[]
      : T
    : {
        [K in keyof T as CamelToSnakeCase<K & string>]: CamelToSnakeCaseNested<
          T[K]
        >;
      }
  : T;

function camelToSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function camelToSnakeCaseNested<T>(
  obj: T,
  parentKey?: string
): CamelToSnakeCaseNested<T> {
  if (Array.isArray(obj)) {
    return obj.map((item) =>
      camelToSnakeCaseNested(item)
    ) as CamelToSnakeCaseNested<T>;
  } else if (typeof obj === "object" && obj !== null) {
    const newObj: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const newKey = camelToSnakeCase(key);
        // Keep arbitrary keys the same
        if (
          (parentKey === "metadata" &&
            !Object.keys(reservedTraceMetadataSchema.shape).includes(newKey)) ||
          (parentKey === "params" &&
            !Object.keys(reservedSpanParamsSchema.shape).includes(newKey))
        ) {
          newObj[key] = (obj as any)[key];
        } else {
          newObj[newKey] = camelToSnakeCaseNested((obj as any)[key], newKey);
        }
      }
    }
    return newObj as CamelToSnakeCaseNested<T>;
  } else {
    return obj as CamelToSnakeCaseNested<T>;
  }
}
