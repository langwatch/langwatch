import { expect, test, type APIResponse } from "@playwright/test";

test.use({
  storageState: "./e2e/auth.json",
  actionTimeout: 120000,
});

test.setTimeout(120000);

const PROJECT_ID = "fyes-lT_hZ2";
const LANGY_CHAT_URL = "http://localhost:5560/api/langy/chat";

async function readStreamBody(res: APIResponse) {
  return await res.text();
}

test("Langy chat streams a response and returns a conversation id", async ({
  request,
}) => {
  /** @scenario First user message starts a streaming Langy conversation */
  const res = await request.fetch(LANGY_CHAT_URL, {
    method: "POST",
    data: {
      projectId: PROJECT_ID,
      messages: [
        {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "What evaluators are available?" }],
        },
      ],
    },
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    timeout: 120000,
  });

  expect(res.ok()).toBeTruthy();
  expect(res.status()).toBe(200);

  const headers = res.headers();
  const conversationId = headers["x-langy-conversation-id"];
  expect(conversationId).toBeTruthy();

  const contentType = headers["content-type"] ?? "";
  expect(contentType).toContain("text/event-stream");

  const body = await readStreamBody(res);
  expect(body).toContain("data:");
});

test("Langy chat keeps context when reusing conversation id", async ({
  request,
}) => {
  /** @scenario Follow-up user message continues the same Langy conversation */
  const first = await request.fetch(LANGY_CHAT_URL, {
    method: "POST",
    data: {
      projectId: PROJECT_ID,
      messages: [
        {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "List my evaluators briefly." }],
        },
      ],
    },
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    timeout: 120000,
  });

  expect(first.ok()).toBeTruthy();
  const firstConversationId = first.headers()["x-langy-conversation-id"];
  expect(firstConversationId).toBeTruthy();
  await readStreamBody(first);

  const second = await request.fetch(LANGY_CHAT_URL, {
    method: "POST",
    data: {
      projectId: PROJECT_ID,
      conversationId: firstConversationId,
      messages: [
        {
          id: "u2",
          role: "user",
          parts: [{ type: "text", text: "Explain the first one in detail." }],
        },
      ],
    },
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    timeout: 120000,
  });

  expect(second.ok()).toBeTruthy();
  expect(second.status()).toBe(200);
  expect(second.headers()["x-langy-conversation-id"]).toBe(firstConversationId);

  const secondBody = await readStreamBody(second);
  expect(secondBody).toContain("data:");
});
