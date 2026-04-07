import { OpenAI } from "openai";
import { nanoid } from "nanoid";
import { env } from "~/env.mjs";

import type { NextApiRequest, NextApiResponse } from "next";

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY ?? "bogus",
});

const guestQueries = [
  "Room Assistance",
  "Dining Recommendations and Reservations",
  "Transportation Services",
  "Local Area Information",
  "Special Requests",
  "Technical Support",
  "Housekeeping Services",
  "Billing and Check-out Assistance",
];

const SYSTEM_PROMPT =
  "Imagine you're in a bustling hotel lobby, serving as the knowledgeable and friendly concierge. You're the go-to person for guests seeking recommendations, assistance with reservations, or information about local attractions. How would you welcome guests and ensure their stay is memorable? Think about how you'd provide personalized recommendations, handle inquiries efficiently, and maintain a professional yet friendly demeanor.";

const RAG_SYSTEM_PROMPT =
  "You are a restaurant expert knowing the best around town.";

const getRadomGuestQuery = () =>
  guestQueries[Math.floor(Math.random() * guestQueries.length)];

let authToken: string | string[] | undefined;

export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse
) {
  authToken = _req.headers["x-auth-token"];

  if (!authToken) {
    return res
      .status(401)
      .json({ message: "X-Auth-Token header is required." });
  }

  const randomNumberTry = Math.floor(Math.random() * 10);

  if (randomNumberTry % 2 === 0) {
    return res.status(401).json({ message: "Not this time" });
  }

  const randomNumber = Math.floor(Math.random() * 10);

  if (randomNumber % 2 === 0) {
    try {
      const ragResponse = await ragMessage(res);
      res.status(200).json({ message: "Sent to LangWatch", ragResponse });
    } catch (error: any) {
      res.status(500).json({
        message: "Error",
        error: error,
      });
    }
  } else {
    try {
      const threadId = `thread_${nanoid()}`;
      const userId = `user_${nanoid()}`;
      const userInput = (await getInitialMessage()) ?? "";

      const assistantResponse = await firstChatMessage(
        userInput,
        threadId,
        userId,
        res
      );
      const expectedUserResponse = await userResponse(
        userInput,
        assistantResponse ?? ""
      );
      await secondChatMessage(
        userInput,
        assistantResponse ?? "",
        expectedUserResponse ?? "",
        threadId,
        userId,
        res
      );

      res.status(200).json({ message: "Sent to LangWatch" });
    } catch (error: any) {
      res.status(500).json({
        message: "Error",
        error: error,
      });
    }
  }
}

const langwatchAPI = async (
  completion: any,
  input: string,
  res: NextApiResponse,
  threadId: string,
  userId: string,
  type?: string,
  contexts: string[] = []
) => {
  try {
    const contentPrefixId = Math.round(Math.random());
    const ragTime = Math.round(Math.random() * 300);

    const langwatchResponse = await fetch(`${env.BASE_HOST}/api/collector`, {
      method: "POST",
      headers: {
        "X-Auth-Token": authToken as string,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        trace_id: `trace_${nanoid()}`,
        spans: [
          ...(type === "rag"
            ? [
                {
                  name: "RestaurantAPI",
                  type: "rag",
                  span_id: `span_${nanoid()}`,
                  input: {
                    type: "text",
                    value: input,
                  },
                  contexts: contexts.map((context, index) => ({
                    documentId: `doc_${contentPrefixId}_${index}`,
                    content: context,
                  })),
                  timestamps: {
                    started_at: completion.created * 1000 - ragTime,
                    finished_at: completion.created * 1000,
                  },
                },
              ]
            : []),
          {
            type: "llm",
            span_id: `span_${nanoid()}`,
            vendor: "openai",
            model: completion.model,
            input: {
              type: "chat_messages",
              value: [
                {
                  role: "user",
                  content: input,
                },
              ],
            },
            output: {
              type: "chat_messages",
              value: [
                {
                  role: "assistant",
                  content: completion.choices[0].message.content,
                },
              ],
            },
            params: {
              temperature: 0.7,
              stream: false,
            },
            metrics: {
              prompt_tokens: completion.usage.prompt_tokens,
              completion_tokens: completion.usage.completion_tokens,
            },
            timestamps: {
              first_token_at: new Date().getTime(),
              started_at: completion.created * 1000,
              finished_at: new Date().getTime(),
            },
          },
        ],
        metadata: {
          thread_id: threadId,
          user_id: userId,
          labels: type === "rag" ? ["Restaurant API"] : [],
        },
      }),
    });
    const langwatchData = await langwatchResponse.json();
    return langwatchData;
  } catch (error: any) {
    res.status(500).json({
      message: "Error",
      error: error,
    });
  }
};

const userResponse = async (userInput: string, chatResponse: string) => {
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: userInput,
      },
      {
        role: "assistant",
        content: chatResponse,
      },
      {
        role: "user",
        content:
          "Based on the information provided, how would a guest respond to the concierge? Write as if you are the guest.",
      },
    ],
    model: "gpt-3.5-turbo",
  });

  return completion.choices[0]!.message.content;
};

const getInitialMessage = async () => {
  const randomGuestQuery = getRadomGuestQuery();
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: `Using a support request such as.. ${randomGuestQuery}. Pretend you are the guest! No explanation needed. Don't put quotes around your message. Write as if you are the guest. Max 2 sentences.`,
      },
    ],
    model: "gpt-3.5-turbo",
  });

  return completion.choices[0]!.message.content;
};

const ragMessage = async (res: NextApiResponse) => {
  const userInput = "What are the 5 best restaurants in the area?";
  const threadId = `thread_${nanoid()}`;
  const userId = `user_${nanoid()}`;
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content: RAG_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: userInput,
      },
    ],
    model: "gpt-3.5-turbo",
  });

  const completions = (
    await Promise.all(
      Array.from({ length: 2 + Math.floor(Math.random() * 5) }, () => {
        return openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "system",
              content:
                "Invent a restaurant name and a short google maps review of it",
            },
          ],
        });
      })
    )
  ).map((completion) => completion.choices[0]!.message.content ?? "");

  await langwatchAPI(
    completion,
    userInput ?? "",
    res,
    threadId,
    userId,
    "rag",
    completions
  );

  return completion.choices[0]!.message.content;
};

const firstChatMessage = async (
  userInput: string,
  threadId: string,
  userId: string,
  res: NextApiResponse
) => {
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: userInput ?? "",
      },
    ],
    model: "gpt-3.5-turbo",
  });

  await langwatchAPI(completion, userInput ?? "", res, threadId, userId);

  return completion.choices[0]!.message.content;
};

const secondChatMessage = async (
  userInput: string,
  assistantResponse: string,
  expectedUserResponse: string,
  threadId: string,
  userId: string,
  res: NextApiResponse
) => {
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: userInput,
      },
      {
        role: "assistant",
        content: assistantResponse,
      },
      {
        role: "user",
        content: expectedUserResponse,
      },
    ],
    model: "gpt-3.5-turbo",
  });

  await langwatchAPI(
    completion,
    expectedUserResponse ?? "",
    res,
    threadId,
    userId
  );

  return completion.choices[0]!.message.content;
};
