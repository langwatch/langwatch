import {
  AnnotationApi,
  annotationRestListResponseSchema,
  annotationRestParamsSchema,
  annotationRestQuerySchema,
  annotationRestResponseSchema,
  annotationRestWriteSchema,
} from "@langwatch/annotation-contract";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";

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
