import { defineRestRouter } from "/Users/afr/Source/github.com/langwatch/langwatch/packages/api/src/rest/declaration.ts";
import { moduleApi } from "@langwatch/runtime-composition";

const AnnotationApi = moduleApi<object>("annotation");
defineRestRouter(AnnotationApi).withNamespace("annotations").withVersion("2026-08-07")
  .get("/", "deleteAnnotation").withPermission("annotations:update").handle(() => ({ body: "forbidden" }));
