import { ZodType } from "zod";

// zod-openapi v5+ removed the `.openapi()` method extension and the
// `zod-openapi/extend` side-effect import (OpenAPI metadata moved to zod 4's
// native `z.meta()` registry). Our schemas call `.openapi({...})` purely as
// documentation metadata, and that call was already a runtime no-op under
// Next.js (the previous zod-openapi/extend patch didn't apply there — see git
// history). Preserve exactly that behaviour with a self-contained, typed no-op
// `.openapi()` on the base ZodType, so the existing call sites keep working
// unchanged without a per-schema rewrite. Real OpenAPI generation (if
// reintroduced) should migrate to `z.meta()` separately.

declare module "zod" {
  interface ZodType {
    openapi(metadata?: unknown): this;
  }
}

// Patch at module load so `.openapi()` is defined before any schema module that
// calls it at definition time (side-effect parity with the old
// `import "zod-openapi/extend"`).
const proto = ZodType.prototype as unknown as {
  openapi?: (metadata?: unknown) => unknown;
};
if (!proto.openapi) {
  proto.openapi = function (this: unknown) {
    return this;
  };
}

// Kept for backwards compatibility with the ~30 call sites that invoke it in
// their route setup. The patch above already ran at import time; this is now an
// idempotent no-op.
export const patchZodOpenapi = () => {
  if (!proto.openapi) {
    proto.openapi = function (this: unknown) {
      return this;
    };
  }
};
