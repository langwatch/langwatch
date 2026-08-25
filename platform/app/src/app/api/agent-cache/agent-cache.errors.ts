import { HandledError } from "@langwatch/handled-error";

import { remediation } from "~/server/app-layer/error-remediation";

/**
 * The project holds no live entry under the requested name.
 *
 * One code answers every empty read: never stored, past its lifetime, dropped
 * by the cache, or written before the instance's encryption key changed. The
 * caller does the same thing in all four cases, which is to produce the value
 * again and store it, so telling them apart would add words without adding a
 * choice.
 */
export class CacheEntryNotFoundError extends HandledError {
  declare readonly code: "cache_entry_not_found";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "cache_entry_not_found",
      "This project holds no cache entry under that name. Store it first, or check the name.",
      {
        httpStatus: 404,
        fault: "customer",
        ...remediation("cache_entry_not_found"),
        ...options,
      },
    );
    this.name = "CacheEntryNotFoundError";
  }
}
