/**
 * Transforms any members of the object T having type FromType
 * to ToType. This applies only to exact type matches.
 * This is for the case where FromType is a union and only those fields
 * matching the same union should be transformed.
 *
 * @public
 */
export type Transform<T, FromType, ToType> = RecursiveTransformExact<T, FromType, ToType>;
/**
 * Returns ToType if T matches exactly with FromType.
 *
 * @internal
 */
type TransformExact<T, FromType, ToType> = [T] extends [FromType] ? ([FromType] extends [T] ? ToType : T) : T;
/**
 * Applies TransformExact to members of an object recursively.
 *
 * @internal
 */
type RecursiveTransformExact<T, FromType, ToType> = T extends Function ? T : T extends object ? {
    [key in keyof T]: [T[key]] extends [FromType] ? [FromType] extends [T[key]] ? ToType : RecursiveTransformExact<T[key], FromType, ToType> : RecursiveTransformExact<T[key], FromType, ToType>;
} : TransformExact<T, FromType, ToType>;
export {};
