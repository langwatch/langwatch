/**
 * The one dated version every v1 project API family serves.
 *
 * The families version together: a caller pins
 * `/api/v1/<family>/2026-08-27/...` and gets the same vintage everywhere, and a
 * future breaking change bumps this constant in exactly one place per family by
 * adding a new `.version(...)` block.
 */
export const V1_API_VERSION = "2026-08-27";
