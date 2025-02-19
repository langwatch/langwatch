import { type NextRequest, NextResponse } from "next/server";
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

  const triggerId = req.nextUrl.searchParams.get("triggerId") ?? "";

  const trigger = await prisma.trigger.findUnique({
    where: { id: triggerId, projectId: project.id },
  });

  if (!trigger) {
    return NextResponse.json(
      { message: "Trigger not found." },
      { status: 404 }
    );
  }

  // Check if the last trigger sent was triggered within the last 1 hour
  const lastTriggerSent = await prisma.triggerSent.findFirst({
    where: { triggerId, projectId: project.id },
    orderBy: { createdAt: "desc" },
  });

  if (!lastTriggerSent) {
    return NextResponse.json(
      { message: "No trigger sent found." },
      { status: 404 }
    );
  }

  const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);
  if (lastTriggerSent.createdAt < oneHourAgo) {
    return NextResponse.json(
      { message: "Trigger not triggered within the last hour." },
      { status: 404 }
    );
  }

  return NextResponse.json({
    status: 200,
    body: {
      message: "Trigger triggered within the last hour.",
    },
  });
}
