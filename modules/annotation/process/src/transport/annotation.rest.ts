import {
  AnnotationApi,
  annotationRestDeletedSchema,
  annotationRestListResponseSchema,
  annotationRestParamsSchema,
  annotationRestQuerySchema,
  annotationRestResponseSchema,
  annotationRestWriteSchema,
} from "@langwatch/annotation-contract";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";

export const annotationRest = defineRestRouter(AnnotationApi)
  .withNamespace("annotations")
  .withVersion(MANAGEMENT_API_VERSION)

  .get("/", "listAnnotations")
  .withQuery(annotationRestQuerySchema)
  .withPermission("annotations:view")
  .withOutput(annotationRestListResponseSchema)
  .withDocs({
    operationId: "getApiAnnotations",
    summary: "List annotations in the caller’s project",
  })
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
  .withDocs({
    operationId: "getApiAnnotationsId",
    summary: "Get an annotation in the caller’s project",
  })
  .handle(async ({ app, input, scope }) => {
    const annotation = await app.getById({
      id: input.id,
      projectId: scope.id,
    });

    return { data: annotation };
  })

  .patch("/:id", "updateAnnotation")
  .withAudit("annotation.update")
  .withParams(annotationRestParamsSchema)
  .withInput(annotationRestWriteSchema)
  .withPermission("annotations:manage")
  .withOutput(annotationRestResponseSchema)
  .withDocs({
    operationId: "patchApiAnnotationsId",
    summary: "Update an annotation in the caller’s project",
  })
  .handle(async ({ app, input, scope }) => {
    const annotation = await app.update({
      ...input,
      projectId: scope.id,
    });

    return { data: annotation };
  })

  .delete("/:id", "deleteAnnotation")
  .withAudit("annotation.deleteById")
  .withParams(annotationRestParamsSchema)
  .withPermission("annotations:manage")
  .withConfirmation({
    resource: "annotation",
    action: "delete",
    idParam: "id",
    name: async ({ app, projectId, id }) => {
      const annotation = await app.getById({ id, projectId }).catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.httpStatus === 404) return undefined;
        throw error;
      });
      if (!annotation) return undefined;
      return annotation.comment ? annotation.comment.slice(0, 60) : null;
    },
  })
  .withOutput(annotationRestDeletedSchema)
  .withDocs({
    operationId: "deleteApiAnnotationsId",
    summary: "Delete an annotation in the caller’s project",
  })
  .handle(async ({ app, input, scope }) => {
    await app.delete({ id: input.id, projectId: scope.id });

    return { status: "success", message: "Annotation deleted." };
  })

  .get("/trace/:id", "listTraceAnnotations")
  .withParams(annotationRestParamsSchema)
  .withQuery(annotationRestQuerySchema)
  .withPermission("annotations:view")
  .withOutput(annotationRestListResponseSchema)
  .withDocs({
    operationId: "getApiAnnotationsTraceId",
    summary: "List annotations on a trace in the caller’s project",
  })
  .handle(async ({ app, input, scope }) => {
    const annotations = await app.list({
      projectId: scope.id,
      traceIds: [input.id],
      anchor: input.anchor,
    });

    return { data: annotations };
  })

  .post("/trace/:id", "createTraceAnnotation")
  .withAudit("annotation.create")
  .withParams(annotationRestParamsSchema)
  .withInput(annotationRestWriteSchema)
  .withPermission("annotations:create")
  .withOutput(annotationRestResponseSchema)
  .withDocs({
    operationId: "postApiAnnotationsTraceId",
    summary: "Create an unattributed annotation on a trace",
  })
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
