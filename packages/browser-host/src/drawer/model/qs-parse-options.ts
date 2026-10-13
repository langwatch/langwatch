import type { IParseOptions } from "qs";

/**
 * Shared options for URLs whose arrays serialize as comma lists (drawer
 * state, filters). `arrayLimit` must stay above any realistic selection:
 * past it, qs returns an index-keyed object, corrupting bulk-selected ids.
 */
export const URL_QS_PARSE_OPTIONS: IParseOptions = {
  allowDots: true,
  comma: true,
  allowEmptyArrays: true,
  arrayLimit: 1000,
};
