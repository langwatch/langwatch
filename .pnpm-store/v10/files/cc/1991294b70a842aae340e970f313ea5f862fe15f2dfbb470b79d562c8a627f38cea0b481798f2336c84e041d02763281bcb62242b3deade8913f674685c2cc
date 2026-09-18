import type { Schema } from "@smithy/types";
/**
 * Determines whether a schema tree contains BigInteger or BigDecimal members,
 * which require a JSON.parse reviver to preserve numeric precision.
 *
 * The result is cached on the root static schema array (struct schemas) via a Symbol key,
 * so subsequent calls for the same schema are O(1).
 *
 * @internal
 */
export declare function needsReviver(schema: Schema): boolean;
