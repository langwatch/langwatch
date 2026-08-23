/**
 * The one dated version every management API family serves.
 *
 * The management surface shipped as a single product decision, so its families
 * version together: a caller pins `/api/<family>/2026-08-07/...` and gets the
 * same vintage everywhere, and a future breaking change bumps this constant in
 * exactly one place per family by adding a new `.version(...)` block.
 */
export const MANAGEMENT_API_VERSION = "2026-08-07";
