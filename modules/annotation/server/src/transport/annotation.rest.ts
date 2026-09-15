import {
  AnnotationApi,
  AnnotationNotFoundError,
  annotationRestListResponseSchema,
  annotationRestParamsSchema,
  annotationRestQuerySchema,
  annotationRestResponseSchema,
  annotationRestWriteSchema,
} from "@langwatch/annotation-contract";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RequestValidationError,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import type { Context } from "hono";

export const annotationRest = defineRestRouter(AnnotationApi)
  .withNamespace("annotations")
  .withVersion(MANAGEMENT_API_VERSION)

  .get("/", "listAnnotations")
  .withQuery(annotationRestQuerySchema)
  .withPermission("annotations:view")
  .withOutput(annotationRestListResponseSchema)
  .withDocs({ summary: "List annotations in the caller’s project" })
  .handle(async ({ app, input, scope }) => {
    const annotations = await app.list({
      projectId: scope.id,
      anchor: input.anchor,
    });

    return { data: annotations };
  })

  .get("/:id", "getAnnotation")
  .withParams(annotationRestParamsSchema)
  .withPermission("annotations:view")
  .withOutput(annotationRestResponseSchema)
  .withDocs({ summary: "Get an annotation in the caller’s project" })
  .handle(async ({ app, input, scope }) => {
    const annotation = await app.getById({
      id: input.id,
      projectId: scope.id,
    });

    return { data: annotation };
  })

  .patch("/:id", "updateAnnotation")
  .withParams(annotationRestParamsSchema)
  .withInput(annotationRestWriteSchema)
  .withPermission("annotations:manage")
  .withOutput(annotationRestResponseSchema)
  .withDocs({ summary: "Update an annotation in the caller’s project" })
  .handle(async ({ app, input, scope }) => {
    const annotation = await app.update({
      ...input,
      projectId: scope.id,
    });

    return { data: annotation };
  })

  .delete("/:id", "deleteAnnotation")
  .withParams(annotationRestParamsSchema)
  .withPermission("annotations:manage")
  .withDocs({ summary: "Delete an annotation in the caller’s project" })
  .handle(async ({ app, input, scope }) => {
    await app.delete({ id: input.id, projectId: scope.id });
  })

  .get("/trace/:id", "listTraceAnnotations")
  .withParams(annotationRestParamsSchema)
  .withQuery(annotationRestQuerySchema)
  .withPermission("annotations:view")
  .withOutput(annotationRestListResponseSchema)
  .withDocs({ summary: "List annotations on a trace in the caller’s project" })
  .handle(async ({ app, input, scope }) => {
    const annotations = await app.list({
      projectId: scope.id,
      traceIds: [input.id],
      anchor: input.anchor,
    });

    return { data: annotations };
  })

  .post("/trace/:id", "createTraceAnnotation")
  .withParams(annotationRestParamsSchema)
  .withInput(annotationRestWriteSchema)
  .withPermission("annotations:create")
  .withOutput(annotationRestResponseSchema)
  .withDocs({ summary: "Create an unattributed annotation on a trace" })
  .handle(async ({ app, input, scope }) => {
    const annotation = await app.createUnattributed({
      projectId: scope.id,
      traceId: input.id,
      comment: input.comment,
      isThumbsUp: input.isThumbsUp,
      email: input.email,
    });

    return { data: annotation };
  })
  .build();

/**
 * Every refusal these routes raise, in the bodies this family has always
 * answered. It travels with the declaration rather than with the process that
 * mounts it: `{ status, message }` is not the house shape, and a published
 * family cannot change what it answers because its installer moved.
 */
export const annotationRestErrors: RestErrorHandler = (error, context) => {
  if (error instanceof AnnotationNotFoundError) {
    return context.json({ status: "error", message: "Annotation not found." }, 404);
  }

  if (isRequestValidationError(error)) return validationFailure(context, error);

  return context.json({ status: "error", message: "Internal server error." }, 500);
};

function isRequestValidationError(error: unknown): error is RequestValidationError {
  return error instanceof Error && error.name === "RequestValidationError";
}

function validationFailure(context: Context, error: RequestValidationError): Response {
  const fields = (error.meta.fields as string[] | undefined) ?? [];

  if (offends(fields, "comment")) {
    return context.json(
      {
        status: "error",
        message: "[comment] is required in the request body and must be a string.",
      },
      400,
    );
  }

  if (offends(fields, "isThumbsUp")) {
    return context.json(
      {
        status: "error",
        message: "[isThumbsUp] is required in the request body and must be a boolean.",
      },
      400,
    );
  }

  return context.json({ status: "error", message: "Invalid request body." }, 400);
}

function offends(fields: readonly string[], name: string): boolean {
  return fields.some((field) => field === name || field.startsWith(`${name}.`));
}
