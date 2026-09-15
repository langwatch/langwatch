import { z } from "zod";
import { defineRestRouter } from "/Users/afr/Source/github.com/langwatch/langwatch/packages/api/src/rest/declaration.ts";
import { moduleApi } from "@langwatch/runtime-composition";

interface AnnotationApi {
  getAnnotation(input: { id: string }): Promise<{ id: string }>;
  updateAnnotation(input: { id: string; title: string }): Promise<{ id: string }>;
  deleteAnnotation(input: { id: string }): Promise<void>;
}

const AnnotationApi = moduleApi<AnnotationApi>("annotation");
const transportDeclaration = defineRestRouter(AnnotationApi)
  .withNamespace("annotations")
  .withVersion("2026-08-07")
  .get("/:id", "getAnnotation")
  .withParams(z.object({ id: z.string() }))
  .withPermission("annotations:view")
  .withOutput(z.object({ id: z.string() }))
  .handle(async ({ app, input }) => app.getAnnotation({ id: input.id }))
  .patch("/:id", "updateAnnotation")
  .withParams(z.object({ id: z.string() }))
  .withInput(z.object({ title: z.string() }))
  .withPermission("annotations:update")
  .withOutput(z.object({ id: z.string() }))
  .handle(({ app, input }) => app.updateAnnotation(input))
  .delete("/:id", "deleteAnnotation")
  .withParams(z.object({ id: z.string() }))
  .withPermission("annotations:update")
  .handle(({ app, input }) => app.deleteAnnotation(input))
  .build();
transportDeclaration.router();
