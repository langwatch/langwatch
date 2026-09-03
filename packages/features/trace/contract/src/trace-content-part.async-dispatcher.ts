import { dispatchContentPart } from "./trace-content-part.dispatcher";
import type { AsyncContentPartVisitor } from "./trace-content-part.types";

export async function visitContentPartAsync<R>(
  part: unknown,
  visitor: AsyncContentPartVisitor<R>,
): Promise<R | undefined> {
  return await dispatchContentPart(part, visitor);
}
