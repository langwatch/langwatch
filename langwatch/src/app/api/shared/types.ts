export interface RouteResponse {
  // If the description is missing, it will break our documenations
  description: string;
  content: Record<string, { schema: any }>;
  // Response headers a caller can read something from. Only worth declaring
  // for a header that carries meaning the body does not, which is why this is
  // optional rather than filled in everywhere.
  headers?: Record<string, { description: string; schema: any }>;
}
