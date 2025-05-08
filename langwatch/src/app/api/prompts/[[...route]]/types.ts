export interface RouteResponse {
  // If the description is missing, it will break our documenations
  description: string;
  content: Record<string, { schema: any }>;
}
