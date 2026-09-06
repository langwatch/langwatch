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

export async function listAnnotations(): Promise<AnnotationResponse[]> {
  return makeRequest("GET", "/api/annotations") as Promise<AnnotationResponse[]>;
}

export async function getAnnotation(id: string): Promise<AnnotationResponse> {
  return makeRequest(
    "GET",
    `/api/annotations/${encodeURIComponent(id)}`,
  ) as Promise<AnnotationResponse>;
}

export async function getAnnotationsByTrace(traceId: string): Promise<AnnotationResponse[]> {
  return makeRequest(
    "GET",
    `/api/annotations/trace/${encodeURIComponent(traceId)}`,
  ) as Promise<AnnotationResponse[]>;
}

export async function createAnnotation(
  traceId: string,
  data: { comment?: string; isThumbsUp?: boolean; email?: string },
): Promise<AnnotationResponse> {
  return makeRequest(
    "POST",
    `/api/annotations/trace/${encodeURIComponent(traceId)}`,
    data,
  ) as Promise<AnnotationResponse>;
}

export async function deleteAnnotation(id: string): Promise<{ status?: string; message?: string }> {
  return makeRequest(
    "DELETE",
    `/api/annotations/${encodeURIComponent(id)}`,
  ) as Promise<{ status?: string; message?: string }>;
}
