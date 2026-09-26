import { makeRequest } from "./langwatch-api.js";

export interface AnnotationResponse {
  id?: string;
  projectId?: string;
  traceId?: string;
  comment?: string;
  isThumbsUp?: boolean;
  userId?: string;
  email?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Every annotations endpoint except delete answers `{ "data": … }` (see
 * platform/app/src/server/routes/annotations.ts). Unwrap it, and refuse a
 * 2xx body that carries no envelope instead of handing the caller something
 * that only looks like the payload — the same contract the Go client
 * enforces (#7866, sibling of the TypeScript SDK fix in #7865).
 */
function unwrapData<T>(response: unknown, operation: string): T {
  if (typeof response === "object" && response !== null && "data" in response) {
    const data = (response as { data: T | null }).data;
    if (data != null) {
      return data;
    }
  }
  throw new Error(
    `LangWatch ${operation} response carried no "data" envelope`,
  );
}

export async function listAnnotations(): Promise<AnnotationResponse[]> {
  return unwrapData<AnnotationResponse[]>(
    await makeRequest("GET", "/api/annotations"),
    "listAnnotations",
  );
}

export async function getAnnotation(id: string): Promise<AnnotationResponse> {
  return unwrapData<AnnotationResponse>(
    await makeRequest("GET", `/api/annotations/${encodeURIComponent(id)}`),
    "getAnnotation",
  );
}

export async function getAnnotationsByTrace(traceId: string): Promise<AnnotationResponse[]> {
  return unwrapData<AnnotationResponse[]>(
    await makeRequest(
      "GET",
      `/api/annotations/trace/${encodeURIComponent(traceId)}`,
    ),
    "getAnnotationsByTrace",
  );
}

export async function createAnnotation(
  traceId: string,
  data: { comment?: string; isThumbsUp?: boolean; email?: string },
): Promise<AnnotationResponse> {
  return unwrapData<AnnotationResponse>(
    await makeRequest(
      "POST",
      `/api/annotations/trace/${encodeURIComponent(traceId)}`,
      data,
    ),
    "createAnnotation",
  );
}

export async function deleteAnnotation(id: string): Promise<{ status?: string; message?: string }> {
  return makeRequest(
    "DELETE",
    `/api/annotations/${encodeURIComponent(id)}`,
  ) as Promise<{ status?: string; message?: string }>;
}
