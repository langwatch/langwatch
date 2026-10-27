/** One parameterized WHERE fragment and the parameters it binds. */
export type CustomMetadataCondition = {
  sql: string;
  params: Record<string, unknown>;
};

/** Input of the custom metadata condition builders. */
export type CustomMetadataConditionInput = {
  values: string[];
  paramId: string;
  /** Alias of the row carrying `Attributes` in the caller's query. */
  alias: string;
};

const storedKeys = (key: string) => {
  const rawKey = key.replaceAll("·", ".");
  return {
    canonical: `metadata.${rawKey}`,
    lw: `langwatch.metadata.${rawKey}`,
    bare: rawKey,
  };
};

/**
 * Custom metadata sits under `metadata.{key}`, `langwatch.metadata.{key}` or a bare `{key}`;
 * trace search and analytics all filter through these builders, so they match the same
 * traces. A key holding an empty value is not present. See langwatch/tasks#919.
 */
export function customMetadataKeyCondition({
  values,
  paramId,
  alias,
}: CustomMetadataConditionInput): CustomMetadataCondition {
  if (values.length === 0) return { sql: "1=0", params: {} };
  // mapContains keeps the bloom filter on mapKeys(Attributes) usable.
  const present = (param: string) =>
    `(mapContains(${alias}.Attributes, {${param}:String}) AND ${alias}.Attributes[{${param}:String}] != '')`;
  const conditions = values.map(
    (_value, i) =>
      `(${present(`${paramId}_k${i}_canonical`)} OR ${present(`${paramId}_k${i}_lw`)} OR ${present(`${paramId}_k${i}_bare`)})`,
  );
  const params: Record<string, unknown> = {};
  values.forEach((value, i) => {
    const keys = storedKeys(value);
    params[`${paramId}_k${i}_canonical`] = keys.canonical;
    params[`${paramId}_k${i}_lw`] = keys.lw;
    params[`${paramId}_k${i}_bare`] = keys.bare;
  });
  return {
    sql: conditions.length === 1 ? conditions[0]! : `(${conditions.join(" OR ")})`,
    params,
  };
}

/** {@link customMetadataKeyCondition}, matching the key's value instead. */
export function customMetadataValueCondition({
  values,
  paramId,
  key,
  alias,
}: CustomMetadataConditionInput & { key: string | undefined }): CustomMetadataCondition {
  if (!key) return { sql: "1=0", params: {} };
  const keys = storedKeys(key);
  const valuesParam = `{${paramId}_values:Array(String)}`;
  return {
    sql: `(${alias}.Attributes[{${paramId}_canonical:String}] IN (${valuesParam}) OR ${alias}.Attributes[{${paramId}_lw:String}] IN (${valuesParam}) OR ${alias}.Attributes[{${paramId}_bare:String}] IN (${valuesParam}))`,
    params: {
      [`${paramId}_canonical`]: keys.canonical,
      [`${paramId}_lw`]: keys.lw,
      [`${paramId}_bare`]: keys.bare,
      [`${paramId}_values`]: values,
    },
  };
}
