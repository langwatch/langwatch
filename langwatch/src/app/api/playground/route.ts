import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { getServerSession } from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "../../../env.mjs";
import { backendHasTeamProjectPermission } from "../../../server/api/permission";
import {
  getModelOrDefaultApiKey,
  getModelOrDefaultEndpointKey,
  getModelOrDefaultEnvKey,
  getProjectModelProviders,
} from "../../../server/api/routers/modelProviders";
import { authOptions } from "../../../server/auth";
import { prisma } from "../../../server/db";
import { type modelProviders } from "../../../server/modelProviders/registry";

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
  const providers = await getProjectModelProviders(projectId);
  const provider = providers[providerKey];
  if (!provider) {
    return NextResponse.json(
      { error: `Provider not configured: ${providerKey}` },
      { status: 400 }
    );
  }

  if (!provider.enabled) {
    return NextResponse.json(
      {
        error: `Provider ${providerKey} is disabled, go to settings to enable it`,
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

  const headers: Record<string, string> = {};
  const apiKey = getModelOrDefaultApiKey(provider);
  if (apiKey) {
    headers["x-litellm-api-key"] = apiKey;
  }
  const endpoint = getModelOrDefaultEndpointKey(provider);
  if (endpoint) {
    headers["x-litellm-api-base"] = endpoint;
  }

  if (providerKey === "vertex_ai") {
    headers["x-litellm-vertex-project"] =
      getModelOrDefaultEnvKey(provider, "VERTEXAI_PROJECT") ?? "invalid";
    headers["x-litellm-vertex-location"] =
      getModelOrDefaultEnvKey(provider, "VERTEXAI_LOCATION") ?? "invalid";
  }

  const vercelProvider = createOpenAI({
    baseURL: `${env.LANGWATCH_NLP_SERVICE}/proxy/v1`,
    headers,
  });

  const systemPrompt = req.headers.get("x-system-prompt");
  try {
    const result = await streamText({
      model: vercelProvider(model),
      system: systemPrompt?.trim() ? systemPrompt : undefined,
      messages,
      maxRetries: provider.customKeys ? 1 : 3,
    });

    return result.toAIStreamResponse();
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
