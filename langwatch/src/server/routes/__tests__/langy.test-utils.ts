/**
 * Shared helpers for Langy route tests. Per implementation-plan.md PR-1.1.
 *
 * Tests should call `postLangyChat(app, body)` (passing the Hono app
 * imported from `~/server/routes/langy`) rather than building requests
 * inline. The fake session/permission/rate-limit hooks live next to the
 * test that uses them via `vi.mock`, since vitest mock factories must
 * stay in the test file.
 */
import type { Hono } from "hono";

export interface LangyChatRequestBody {
  messages?: unknown[];
  projectId?: string;
  experimentSlug?: string;
  conversationId?: string | null;
}

/**
 * POST a chat request to the Langy route. The caller is responsible
 * for installing whatever auth/permission/rate-limit mocks they need.
 */
export async function postLangyChat(
  app: Hono,
  body: LangyChatRequestBody,
): Promise<Response> {
  return app.request("/api/langy/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A session shape that satisfies the route's `session.user.id` lookups. */
export function fakeLangySession(
  overrides: { userId?: string; email?: string } = {},
) {
  return {
    user: {
      id: overrides.userId ?? "user_test_abc",
      email: overrides.email ?? "tester@example.com",
    },
    expires: "2099-01-01",
  };
}
