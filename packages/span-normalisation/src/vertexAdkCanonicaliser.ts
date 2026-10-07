import type { AttributeCanonicaliser, ExtractorContext } from "./canonicalAttributes.ts";
import { canonicaliseVertexAdkCore, isVertexAdkSpan } from "./vertexAdkCore.ts";
import { canonicaliseVertexAdkRequest } from "./vertexAdkRequest.ts";
import { canonicaliseVertexAdkResponse } from "./vertexAdkResponse.ts";
import { canonicaliseVertexAdkToolCall } from "./vertexAdkToolCall.ts";

export class VertexAdkCanonicaliserService implements AttributeCanonicaliser {
  static create(): VertexAdkCanonicaliserService {
    return new VertexAdkCanonicaliserService();
  }

  private constructor() {}

  readonly id = "vertex-adk";

  apply(ctx: ExtractorContext): void {
    if (!isVertexAdkSpan(ctx)) {
      return;
    }

    canonicaliseVertexAdkCore(ctx);
    canonicaliseVertexAdkRequest(ctx);
    canonicaliseVertexAdkResponse(ctx);
    canonicaliseVertexAdkToolCall(ctx);
  }
}
