/** Length of decoded KSUID in bytes (timestamp + instance + sequence) */
export const DECODED_LEN = 21;

/** Length of base62 encoded KSUID payload */
export const ENCODED_LEN = 29;

/** Regex to match KSUID format: (env_)?resource_encoded */
export const KSUID_REGEX = /^(?:([a-z\d]+)_)?([a-z\d]+)_([a-zA-Z\d]{29})$/;

/** Regex to validate prefix characters (lowercase letters and digits) */
export const PREFIX_REGEX = /^[a-z\d]+$/;

/** Maximum timestamp value (48 bits) */
export const MAX_TIMESTAMP = 2n ** 48n - 1n;

/** Maximum date: 8921556-12-07T10:44:16Z */
export const MAX_DATE = new Date(Number(MAX_TIMESTAMP) * 1000);
