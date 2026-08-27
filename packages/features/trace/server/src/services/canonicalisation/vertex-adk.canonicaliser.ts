import type {
  CanonicalAttributesPort,
  ExtractorContext,
} from "../../ports/canonical-attributes.port";
import { canonicaliseVertexAdkCore, isVertexAdkSpan } from "../vertex-adk-core.rules";
import { canonicaliseVertexAdkRequest } from "../vertex-adk-request.rules";
import { canonicaliseVertexAdkResponse } from "../vertex-adk-response.rules";
import { canonicaliseVertexAdkToolCall } from "../vertex-adk-tool-call.rules";

export class VertexAdkCanonicaliser implements CanonicalAttributesPort {
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
