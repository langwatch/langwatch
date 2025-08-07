import { http } from "msw";
import { setupServer } from "msw/node";
import { beforeAll, afterEach, afterAll } from "vitest";
import { handles } from "./handlers";

export const server = setupServer(
  ...handles,
  http.all("*", ({ request }) => {
    console.log("🌐 MSW intercepted:", request.method, request.url);

    // Don't return 404, let it pass through for now
    return;
  }),
);

beforeAll(async () => {
  console.log("🚀 Starting MSW server...");
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
  console.log("🛑 Closing MSW server...");
  server.close();
});
