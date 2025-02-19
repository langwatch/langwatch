import { type NextRequest, NextResponse } from "next/server";
import { env } from "../../../../env.mjs";
import { prisma } from "../../../../server/db";

export async function GET(req: NextRequest) {
  const xAuthToken = req.headers.get("x-auth-token");
  const authHeader = req.headers.get("authorization");

  const authToken =
    xAuthToken ??
    (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

  if (!authToken) {
    return NextResponse.json(
      {
        message:
          "Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token.",
      },
      { status: 401 }
    );
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken },
    include: {
      team: true,
    },
  });

  if (!project) {
    return NextResponse.json(
      { message: "Invalid auth token." },
      { status: 401 }
    );
  }

  const workflowId = req.nextUrl.searchParams.get("workflowId") ?? "";

  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId, projectId: project.id },
  });

  if (!workflow) {
    return NextResponse.json(
      { message: "Workflow not found." },
      { status: 404 }
    );
  }

  let response: Response | null = null;
  let attempts = 0;
  const maxAttempts = 3;
  while (attempts < maxAttempts) {
    response = await fetch(`${env.BASE_HOST}/api/workflows/${workflowId}/run`, {
      method: "POST",
      headers: {
        "X-Auth-Token": authToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: "🐥",
      }),
    });
    if (response.ok) {
      break;
    } else if (attempts < maxAttempts - 1) {
      await sleep(1000);
      attempts++;
    } else {
      return NextResponse.json(
        { message: `Failed to run sample workflow: ${await response.text()}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    status: response?.status,
    body: await response?.json(),
  });
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
