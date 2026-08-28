import { ZodType } from "zod";

interface OpenApiMetadata extends Record<string, unknown> {
  ref?: string;
}

declare module "zod" {
  interface ZodType {
    openapi(metadata: OpenApiMetadata): this;
  }
}

/**
 * Applied on import of this module, not by its callers.
 *
 * Feature modules call `.openapi()` on schemas at module scope, so the patch
 * has to be in place before any of them is evaluated. Thirty of them used to
 * call `patchZodOpenapi()` themselves through the `app-rest` barrel — which
 * is a cycle: the barrel imports the features, so the feature body ran before
 * the barrel's own export bindings were initialised and the call threw
 * "patchZodOpenapi is not a function". Importing this module for its side
 * effect is what removes the ordering problem rather than moving it.
 *
 * The function stays exported and stays idempotent, for a composition root
 * that wants to be explicit.
 */
export const patchZodOpenapi = () => {
  // Zod 4 owns JSON Schema metadata natively. The old zod-openapi prototype
  // extension targets Zod 3 and replaces Zod 4 object methods with wrappers
  // that crash on `.omit()`/`.pick()`. Preserve the small legacy `.openapi()`
  // call surface by translating it to Zod 4 metadata without touching any
  // other schema method.
  if (!ZodType.prototype.openapi) {
    ZodType.prototype.openapi = function (metadata: OpenApiMetadata) {
      const { ref, ...openApi } = metadata;
      return this.meta({
        ...openApi,
        ...(ref ? { id: ref } : {}),
      }) as this;
    };
  }
};
