import OpenAI from "openai";
import { nanoid } from "nanoid";
import { env } from "../../../../langwatch/langwatch/src/env.mjs";

import type { NextApiRequest, NextApiResponse } from "next";

const openai = new OpenAI();

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

  try {
    const threadId = `thread_${nanoid()}`;
    const userInput = (await getInitialMessage()) ?? ""; // Ensure userInput is a string

    const assistantResponse = await firstChatMessage(userInput, threadId, res);
    const expectedUserResponse = await userResponse(
      userInput,
      assistantResponse ?? ""
    );
    await secondChatMessage(
      userInput,
      assistantResponse ?? "",
      expectedUserResponse ?? "",
      threadId,
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

const langwatchAPI = async (
  completion: any,
  input: string,
  res: NextApiResponse,
  threadId: string
) => {
  console.log(env.NEXTAUTH_URL);
  try {
    const langwatchResponse = await fetch(`${env.NEXTAUTH_URL}/api/collector`, {
      method: "POST",
      headers: {
        "X-Auth-Token": authToken as string,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        trace_id: `trace_${nanoid()}`,
        spans: [
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
            outputs: [
              {
                type: "chat_messages",
                value: [
                  {
                    role: "assistant",
                    content: completion.choices[0].message.content,
                    function_call: null,
                    tool_calls: [],
                  },
                ],
              },
            ],
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
        content: ` Using a support request such as.. ${randomGuestQuery}. Pretend you are the guest! No explanation needed. Don't put quotes around your message. Write as if you are the guest. Max 2 sentences.`,
      },
    ],
    model: "gpt-3.5-turbo",
  });

  return completion.choices[0]!.message.content;
};

const firstChatMessage = async (
  userInput: string,
  threadId: string,
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

  await langwatchAPI(completion, userInput ?? "", res, threadId);

  return completion.choices[0]!.message.content;
};

const secondChatMessage = async (
  userInput: string,
  assistantResponse: string,
  expectedUserResponse: string,
  threadId: string,
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

  await langwatchAPI(completion, expectedUserResponse ?? "", res, threadId);

  return completion.choices[0]!.message.content;
};
