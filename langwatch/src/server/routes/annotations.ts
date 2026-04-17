/**
 * Hono routes for annotations.
 *
 * Replaces:
 * - src/pages/api/annotations/index.ts
 * - src/pages/api/annotations/[id].ts
 * - src/pages/api/annotations/trace/[trace].ts
 */
import { nanoid } from "nanoid";
import { Hono } from "hono";
import { prisma } from "~/server/db";
import {
  readClientContext,
  trackProductAction,
} from "~/server/telemetry/productAction";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:annotations");

export const app = new Hono().basePath("/api");

// ---------- GET /api/annotations ----------
app.get("/annotations", async (c) => {
  const authToken = c.req.header("x-auth-token");

  if (!authToken) {
    return c.json({ message: "X-Auth-Token header is required." }, 401);
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken },
  });

  if (!project) {
    return c.json({ message: "Invalid auth token." }, 401);
  }

  try {
    const annotations = await prisma.annotation.findMany({
      where: { projectId: project.id },
    });

    if (!annotations || annotations.length === 0) {
      return c.json(
        { status: "error", message: "No annotations found." },
        404,
      );
    }

    return c.json({ data: annotations });
  } catch (e) {
    logger.error(
      { error: e, projectId: project.id },
      "error fetching annotations",
    );
    return c.json(
      {
        status: "error",
        message: e instanceof Error ? e.message : "Internal server error.",
      },
      500,
    );
  }
});

// ---------- GET|DELETE|PATCH /api/annotations/:id ----------
app.get("/annotations/:id", async (c) => {
  const authToken = c.req.header("x-auth-token");
  if (!authToken) {
    return c.json({ message: "X-Auth-Token header is required." }, 401);
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken },
  });
  if (!project) {
    return c.json({ message: "Invalid auth token." }, 401);
  }

  try {
    const annotationId = c.req.param("id");
    const annotation = await prisma.annotation.findUnique({
      where: { id: annotationId, projectId: project.id },
    });
    if (!annotation) {
      return c.json(
        { status: "error", message: "Annotation not found." },
        404,
      );
    }
    return c.json({ data: annotation });
  } catch (e) {
    logger.error(
      { error: e, projectId: project.id },
      "error fetching annotation",
    );
    return c.json(
      {
        status: "error",
        message: e instanceof Error ? e.message : "Internal server error.",
      },
      500,
    );
  }
});

app.delete("/annotations/:id", async (c) => {
  const authToken = c.req.header("x-auth-token");
  if (!authToken) {
    return c.json({ message: "X-Auth-Token header is required." }, 401);
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken },
  });
  if (!project) {
    return c.json({ message: "Invalid auth token." }, 401);
  }

  try {
    const annotationId = c.req.param("id");
    await prisma.annotation.delete({
      where: { id: annotationId, projectId: project.id },
    });
    return c.json({ status: "success", message: "Annotation deleted." });
  } catch (e) {
    logger.error(
      { error: e, projectId: project.id },
      "error deleting annotation",
    );
    return c.json(
      {
        status: "error",
        message: e instanceof Error ? e.message : "ID not found.",
      },
      500,
    );
  }
});

app.patch("/annotations/:id", async (c) => {
  const authToken = c.req.header("x-auth-token");
  if (!authToken) {
    return c.json({ message: "X-Auth-Token header is required." }, 401);
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken },
  });
  if (!project) {
    return c.json({ message: "Invalid auth token." }, 401);
  }

  try {
    const body = await c.req.json();
    const comment = body.comment as string;
    const isThumbsUp = body.isThumbsUp;
    const annotationId = c.req.param("id");
    const email = body.email as string;

    if (!comment || typeof comment !== "string") {
      return c.json(
        {
          status: "error",
          message:
            "[comment] is required in the request body and must be a string.",
        },
        400,
      );
    }
    if (isThumbsUp === undefined || typeof isThumbsUp !== "boolean") {
      return c.json(
        {
          status: "error",
          message:
            "[isThumbsUp] is required in the request body and must be a boolean.",
        },
        400,
      );
    }

    const patchAnnotation = await prisma.annotation.update({
      where: { id: annotationId, projectId: project.id },
      data: {
        comment,
        isThumbsUp,
        email,
      },
    });

    return c.json({ data: patchAnnotation });
  } catch (e) {
    logger.error(
      { error: e, projectId: project.id },
      "error patching annotation",
    );
    return c.json(
      {
        status: "error",
        message: e instanceof Error ? e.message : "Not found",
      },
      500,
    );
  }
});

// ---------- GET|POST /api/annotations/trace/:trace ----------
app.get("/annotations/trace/:trace", async (c) => {
  const authToken = c.req.header("x-auth-token");
  if (!authToken) {
    return c.json({ message: "X-Auth-Token header is required." }, 401);
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken },
  });
  if (!project) {
    return c.json({ message: "Invalid auth token." }, 401);
  }

  try {
    const trace = c.req.param("trace");
    const annotationsByTrace = await prisma.annotation.findMany({
      where: { traceId: trace, projectId: project.id },
    });

    if (!annotationsByTrace || annotationsByTrace.length === 0) {
      return c.json(
        { status: "error", message: "No annotations found." },
        404,
      );
    }

    return c.json({ data: annotationsByTrace });
  } catch (e) {
    logger.error(
      { error: e, trace: c.req.param("trace"), projectId: project.id },
      "error fetching annotations for trace",
    );
    return c.json(
      {
        status: "error",
        message: e instanceof Error ? e.message : "Internal server error.",
      },
      500,
    );
  }
});

app.post("/annotations/trace/:trace", async (c) => {
  const authToken = c.req.header("x-auth-token");
  if (!authToken) {
    return c.json({ message: "X-Auth-Token header is required." }, 401);
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken },
  });
  if (!project) {
    return c.json({ message: "Invalid auth token." }, 401);
  }

  try {
    const body = await c.req.json();
    const comment = body.comment as string;
    const isThumbsUp = body.isThumbsUp;
    const trace = c.req.param("trace");
    const email = body.email as string;

    if (!comment || typeof comment !== "string") {
      return c.json(
        {
          status: "error",
          message:
            "[comment] is required in the request body and must be a string.",
        },
        400,
      );
    }
    if (isThumbsUp === undefined || typeof isThumbsUp !== "boolean") {
      return c.json(
        {
          status: "error",
          message:
            "[isThumbsUp] is required in the request body and must be a boolean.",
        },
        400,
      );
    }
    if (!trace || typeof trace !== "string") {
      return c.json(
        {
          status: "error",
          message: "Trace ID is required and must be a string.",
        },
        400,
      );
    }

    const addAnnotation = await prisma.annotation.create({
      data: {
        id: nanoid(),
        comment,
        projectId: project.id,
        isThumbsUp,
        traceId: trace,
        email,
      },
    });

    void trackProductAction({
      action: "annotation_added",
      projectId: project.id,
      organizationId: async () => {
        const t = await prisma.project.findUnique({
          where: { id: project.id },
          select: { team: { select: { organizationId: true } } },
        });
        return t?.team.organizationId;
      },
      route: "/api/annotations/trace/:trace",
      ...readClientContext((name) => c.req.header(name)),
    });

    return c.json({ data: addAnnotation });
  } catch (e) {
    logger.error(
      { error: e, trace: c.req.param("trace"), projectId: project.id },
      "error creating annotation",
    );
    return c.json(
      {
        status: "error",
        message: e instanceof Error ? e.message : "Internal server error.",
      },
      500,
    );
  }
});
