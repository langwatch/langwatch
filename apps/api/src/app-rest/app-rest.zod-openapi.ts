import { ZodType } from "zod";

interface OpenApiMetadata extends Record<string, unknown> {
  ref?: string;
}

declare module "zod" {
  interface ZodType {
    openapi(metadata: OpenApiMetadata): this;
  }
}

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
