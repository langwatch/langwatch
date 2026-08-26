import type {
  CanonicalAttributesPort,
  ExtractorContext,
} from "../ports/canonical-attributes.port";
import {
  canonicaliseVertexAdkCore,
  isVertexAdkSpan,
} from "../services/vertex-adk-core.service";
import { canonicaliseVertexAdkRequest } from "../services/vertex-adk-request.service";
import { canonicaliseVertexAdkResponse } from "../services/vertex-adk-response.service";
import { canonicaliseVertexAdkToolCall } from "../services/vertex-adk-tool-call.service";

export class VertexAdkCanonicalisationAdapter implements CanonicalAttributesPort {
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
