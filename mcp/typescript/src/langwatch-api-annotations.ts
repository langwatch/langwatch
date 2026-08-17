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
 * Every annotation route answers `{ data: ... }` (the delete route is the one
 * exception and returns `{ status, message }`). These helpers used to cast the
 * raw response straight to `AnnotationResponse[]`, which type-checks — the cast
 * silences it — but is wrong at runtime: `listAnnotations` returned an object,
 * so the tool's `Array.isArray` guard reported "No annotations found" for every
 * project, and `getAnnotation` rendered `undefined` for every field.
 *
 * Unwrap explicitly, and tolerate a bare payload so the helpers keep working if
 * a route is ever un-enveloped.
 */
function unwrapData<T>(payload: unknown): T | undefined {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T | undefined;
}

function unwrapList(payload: unknown): AnnotationResponse[] {
  const data = unwrapData<AnnotationResponse[]>(payload);
  return Array.isArray(data) ? data : [];
}

export async function listAnnotations(): Promise<AnnotationResponse[]> {
  return unwrapList(await makeRequest("GET", "/api/annotations"));
}

export async function getAnnotation(id: string): Promise<AnnotationResponse> {
  return (
    unwrapData<AnnotationResponse>(
      await makeRequest("GET", `/api/annotations/${encodeURIComponent(id)}`),
    ) ?? {}
  );
}

export async function getAnnotationsByTrace(traceId: string): Promise<AnnotationResponse[]> {
  return unwrapList(
    await makeRequest(
      "GET",
      `/api/annotations/trace/${encodeURIComponent(traceId)}`,
    ),
  );
}

export async function createAnnotation(
  traceId: string,
  data: { comment?: string; isThumbsUp?: boolean; email?: string },
): Promise<AnnotationResponse> {
  return (
    unwrapData<AnnotationResponse>(
      await makeRequest(
        "POST",
        `/api/annotations/trace/${encodeURIComponent(traceId)}`,
        data,
      ),
    ) ?? {}
  );
}

export async function deleteAnnotation(id: string): Promise<{ status?: string; message?: string }> {
  return makeRequest(
    "DELETE",
    `/api/annotations/${encodeURIComponent(id)}`,
  ) as Promise<{ status?: string; message?: string }>;
}
