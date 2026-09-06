import { dispatchContentPart } from "./trace-content-part.dispatcher.ts";
import type { AsyncContentPartVisitor } from "./trace-content-part.types.ts";

export async function visitContentPartAsync<R>(
  part: unknown,
  visitor: AsyncContentPartVisitor<R>,
): Promise<R | undefined> {
  return await dispatchContentPart(part, visitor);
}
