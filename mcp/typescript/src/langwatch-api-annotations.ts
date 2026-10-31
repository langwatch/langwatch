import { z } from "zod";

import { makeRequest } from "./langwatch-api.ts";

/** One annotation as the REST API returns it; unknown fields pass through. */
const annotationSchema = z.looseObject({
  id: z.string().nullish(),
  projectId: z.string().nullish(),
  traceId: z.string().nullish(),
  comment: z.string().nullish(),
  isThumbsUp: z.boolean().nullish(),
  userId: z.string().nullish(),
  email: z.string().nullish(),
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
});
export type AnnotationResponse = z.infer<typeof annotationSchema>;
const annotationEnvelopeSchema = z.object({ data: annotationSchema });
const annotationListEnvelopeSchema = z.object({ data: annotationSchema.array() });
/** A 2xx annotations body that is not the `{ data }` envelope. */
export class AnnotationEnvelopeError extends Error {
  readonly code = "annotation_envelope_missing";
  constructor(operation: string, options?: { cause?: unknown }) {
    super(`LangWatch ${operation} response carried no "data" envelope`, options);
    this.name = "AnnotationEnvelopeError";
  }
}
/**
 * Every annotations endpoint except delete answers `{ "data": … }` (see
 * modules/annotation/process/src/transport/annotation.rest.ts). Refuse any
 * other 2xx body rather than return a lookalike shape (#7866).
 */
function unwrapData<T>(schema: z.ZodType<{ data: T }>, response: unknown, operation: string): T {
  const parsed = schema.safeParse(response);
  if (!parsed.success) {
    throw new AnnotationEnvelopeError(operation, { cause: parsed.error });
  }
  return parsed.data.data;
}
export async function listAnnotations(): Promise<AnnotationResponse[]> {
  return unwrapData(
    annotationListEnvelopeSchema,
    await makeRequest("GET", "/api/v1/annotations"),
    "listAnnotations",
  );
}

export async function getAnnotation(id: string): Promise<AnnotationResponse> {
  return unwrapData(
    annotationEnvelopeSchema,
    await makeRequest("GET", `/api/v1/annotations/${encodeURIComponent(id)}`),
    "getAnnotation",
  );
}

export async function getAnnotationsByTrace(traceId: string): Promise<AnnotationResponse[]> {
  return unwrapData(
    annotationListEnvelopeSchema,
    await makeRequest("GET", `/api/v1/annotations/trace/${encodeURIComponent(traceId)}`),
    "getAnnotationsByTrace",
  );
}

export async function createAnnotation(
  traceId: string,
  data: { comment?: string; isThumbsUp?: boolean; email?: string },
): Promise<AnnotationResponse> {
  return unwrapData(
    annotationEnvelopeSchema,
    await makeRequest("POST", `/api/v1/annotations/trace/${encodeURIComponent(traceId)}`, data),
    "createAnnotation",
  );
}

export async function deleteAnnotation(id: string): Promise<{ status?: string; message?: string }> {
  return makeRequest("DELETE", `/api/v1/annotations/${encodeURIComponent(id)}`) as Promise<{
    status?: string;
    message?: string;
  }>;
}
