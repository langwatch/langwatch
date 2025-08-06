import { nanoid } from "nanoid";

/**
 * Creates a handle for a prompt
 * @param prefix - The prefix to use for the handle
 * @returns The handle
 */
export const createHandle = (prefix?: string): Lowercase<string> => {
  return `${prefix ?? ""}_${nanoid()}`.toLowerCase() as Lowercase<string>;
};
