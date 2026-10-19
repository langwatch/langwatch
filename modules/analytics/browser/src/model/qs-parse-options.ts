import type { IParseOptions } from "qs";

/**
 * Shared options for parsing app URLs whose arrays serialize as comma
 * lists. `arrayLimit` must stay well above any realistic selection size:
 * past it, qs returns an index-keyed object, corrupting bulk-selected ids.
 */
export const URL_QS_PARSE_OPTIONS: IParseOptions = {
  allowDots: true,
  comma: true,
  allowEmptyArrays: true,
  arrayLimit: 1000,
};
