import type { IParseOptions } from "qs";

/**
 * Shared options for parsing app URLs whose arrays serialize as comma lists
 * (drawer state, filters). `arrayLimit` must stay well above any realistic
 * selection size: past it, qs returns an index-keyed object instead of an
 * array, which corrupts params like bulk-selected trace ids.
 */
export const URL_QS_PARSE_OPTIONS: IParseOptions = {
  allowDots: true,
  comma: true,
  allowEmptyArrays: true,
  arrayLimit: 1000,
};
