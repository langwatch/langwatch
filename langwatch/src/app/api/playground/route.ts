import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { getServerSession } from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "../../../env.mjs";
import { backendHasTeamProjectPermission } from "../../../server/api/permission";
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "../../../server/api/routers/modelProviders";
import { authOptions } from "../../../server/auth";
import { prisma } from "../../../server/db";

export const dynamic = "force-dynamic";

const errorCache: Record<string, any> = {};

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions(req));
  if (!session) {
    return NextResponse.json(
      { error: "You must be logged in to access this endpoint." },
      { status: 401 }
    );
  }

  const projectId = req.headers.get("x-project-id");
  if (!projectId) {
    return NextResponse.json(
      { error: "Missing projectId header" },
      { status: 400 }
    );
  }

  const hasPermission = await backendHasTeamProjectPermission(
    { prisma, session },
    { projectId },
    "PLAYGROUND"
  );
  if (!hasPermission) {
    return NextResponse.json(
      { error: "You do not have permission to access this endpoint." },
      { status: 403 }
    );
  }

  const { messages } = await req.json();

  const model = req.headers.get("x-model");
  if (!model) {
    return NextResponse.json(
      { error: "Missing model header" },
      { status: 400 }
    );
  }

  const providerKey = model.split("/")[0] as keyof typeof modelProviders;
  const modelProviders = await getProjectModelProviders(projectId);
  const modelProvider = modelProviders[providerKey];
  if (!modelProvider) {
    return NextResponse.json(
      { error: `Provider not configured: ${providerKey.toString()}` },
      { status: 400 }
    );
  }

  if (!modelProvider.enabled) {
    return NextResponse.json(
      {
        error: `Provider ${providerKey.toString()} is disabled, go to settings to enable it`,
      },
      { status: 400 }
    );
  }

  const previousError = errorCache[`${projectId}_${model}`];
  if (previousError) {
    delete errorCache[`${projectId}_${model}`];
    return NextResponse.json(previousError, {
      status: 401,
    });
  }

  const litellmParams = prepareLitellmParams(model, modelProvider);
  const headers = Object.fromEntries(
    Object.entries(litellmParams).map(([key, value]) => [
      `x-litellm-${key}`,
      value,
    ])
  );

  const vercelProvider = createOpenAI({
    apiKey: litellmParams.api_key,
    baseURL: `${env.LANGWATCH_NLP_SERVICE}/proxy/v1`,
    headers,
  });

  const systemPrompt = req.headers.get("x-system-prompt");
  try {
    const result = await streamText({
      model: vercelProvider(model),
      system: systemPrompt?.trim() ? systemPrompt : undefined,
      messages,
      maxRetries: modelProvider.customKeys ? 1 : 3,
    });

    return result.toDataStreamResponse();
  } catch (e: any) {
    try {
      if (e.statusCode === 401 || e.statusCode === 403) {
        const error = JSON.parse(e.cause.value.responseBody);
        errorCache[`${projectId}_${model}`] = {
          error: error.error.message,
        };
        return NextResponse.json(error, {
          status: 401,
        });
      }
    } catch {}
    throw e;
  }
}
