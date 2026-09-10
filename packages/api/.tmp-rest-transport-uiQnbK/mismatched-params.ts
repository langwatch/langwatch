import { z } from "zod";
import { defineRestRouter } from "/Users/afr/Source/github.com/langwatch/langwatch/packages/api/src/rest/declaration.ts";
import { moduleApi } from "@langwatch/runtime-composition";

const AnnotationApi = moduleApi<object>("annotation");
const annotationRestParamsSchema = z.object({ id: z.string() });
defineRestRouter(AnnotationApi).withNamespace("annotations").withVersion("2026-08-07")
  .get("/:idd", "getAnnotation")
  .withParams(annotationRestParamsSchema)
  .withPermission("annotations:view")
  .handle(() => {});
