import type { Hono } from "hono";

/**
 * Utility to test Hono apps by simulating HTTP requests
 *
 * @param app The Hono app instance to test
 * @param path The API path to request
 * @param requestInit Request options (method, headers, body, etc)
 * @returns A Response object from the Hono app
 */
export async function fetchHonoRequest(
  app: Hono,
  path: string,
  requestInit: RequestInit = {}
): Promise<Response> {
  // Create a request object with the specified path and options
  const request = new Request(`http://localhost${path}`, {
    ...requestInit,
  });

  // Use Hono's built-in fetch handler to process the request
  return app.fetch(request);
}
