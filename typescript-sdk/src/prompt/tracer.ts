import { getTracer } from "../observability/trace";

export const tracer = getTracer("langwatch.prompt");
