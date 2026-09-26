/**
 * If the value is an object, stringify it. Otherwise, return the value.
 * @param value - The value to stringify if it is an object.
 * @returns The value as a string.
 */
export const stringifyIfObject = <T>(value: T): T | string => {
  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return value;
};
