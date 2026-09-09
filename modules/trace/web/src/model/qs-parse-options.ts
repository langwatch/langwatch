import type { IParseOptions } from "qs";

/**
 * Shared options for parsing app URLs whose arrays serialize as comma lists (drawer
 * state, filters).
 */
export const URL_QS_PARSE_OPTIONS: IParseOptions = {
  allowDots: true,
  comma: true,
  allowEmptyArrays: true,
  arrayLimit: 1000,
};
