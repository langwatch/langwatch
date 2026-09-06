import { http } from "msw";
import { setupServer } from "msw/node";
import { beforeAll, afterEach, afterAll } from "vitest";

export const server = setupServer(
  http.all("*", ({ request: _request }) => {
    // Don't return 404, let it pass through for now
    return;
  }),
);

beforeAll(async () => {
  console.debug("🚀 Starting MSW server...");
  // NOTE: server.listen must be called before `createClient` is used to ensure
  // the msw can inject its version of `fetch` to intercept the requests.
  server.listen({
    onUnhandledRequest: (req) => {
      throw new Error(`No request handler found for ${req.method} ${req.url}`);
    },
  });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  console.debug("🛑 Closing MSW server...");
  server.close();
});
