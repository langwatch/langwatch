/**
 * The server half of `annotationScore.*`: a permission and a handler per
 * procedure the contract already named.
 */

import { AnnotationApi, annotationScoreTrpc } from "@langwatch/annotation-contract";
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { nanoid } from "nanoid";

function radioOptions(values: readonly string[]) {
  return values.map((value) => ({ label: value, value }));
}

export const annotationScoreTrpcTransport = defineTrpcRouter(AnnotationApi, annotationScoreTrpc)
  .procedure("upsert")
  .withPermission("annotations:manage")
  .handle(async ({ app, input }) =>
    app.upsertScore({
      id: input.annotationScoreId || nanoid(),
      projectId: input.projectId,
      name: input.name,
      dataType: input.dataType,
      description: input.description ?? "",
      options: radioOptions(input.radioCheckboxOptions),
      defaultValue: {
        value: input.defaultRadioOption ?? null,
        options: input.defaultCheckboxOption ?? null,
      },
    }),
  )

  .procedure("getAll")
  .withPermission("annotations:view")
  .handle(async ({ app, input }) => app.listScores({ projectId: input.projectId }))

  .procedure("getAllActive")
  .withPermission("annotations:view")
  .handle(async ({ app, input }) =>
    app.listScores({
      projectId: input.projectId,
      activeOnly: true,
    }),
  )

  .procedure("getById")
  .withPermission("annotations:view")
  .handle(async ({ app, input }) =>
    app.getScore({
      id: input.scoreId,
      projectId: input.projectId,
    }),
  )

  .procedure("toggle")
  .withPermission("annotations:update")
  .handle(async ({ app, input }) =>
    app.toggleScore({
      id: input.scoreId,
      projectId: input.projectId,
      active: input.active,
    }),
  )

  .procedure("delete")
  .withPermission("annotations:delete")
  .handle(async ({ app, input }) =>
    app.deleteScore({
      id: input.scoreId,
      projectId: input.projectId,
    }),
  )
  .build();
