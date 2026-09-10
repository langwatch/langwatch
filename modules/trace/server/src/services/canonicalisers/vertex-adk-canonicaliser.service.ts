import type { AttributeCanonicaliser, ExtractorContext } from "./canonical-attributes.service.ts";
import { canonicaliseVertexAdkCore, isVertexAdkSpan } from "../../rules/vertex-adk-core.rules.ts";
import { canonicaliseVertexAdkRequest } from "../../rules/vertex-adk-request.rules.ts";
import { canonicaliseVertexAdkResponse } from "../../rules/vertex-adk-response.rules.ts";
import { canonicaliseVertexAdkToolCall } from "../../rules/vertex-adk-tool-call.rules.ts";

export class VertexAdkCanonicaliserService implements AttributeCanonicaliser {
  static create(): VertexAdkCanonicaliserService {
    return new VertexAdkCanonicaliserService();
  }

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
