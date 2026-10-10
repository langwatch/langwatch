/**
 * The server half of `promptTags.*`. Each write needs `prompts:manage` on the
 * caller's project only, as on main.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { PromptApi, promptTagTrpc } from "@langwatch/prompt-contract";

export const promptTagTrpcTransport = defineTrpcRouter(PromptApi, promptTagTrpc)
  .procedure("getAll")
  .withPermission("prompts:view")
  .handle(({ app, input }) => app.listTagsForProject({ projectId: input.projectId }))

  .procedure("create")
  .withPermission("prompts:manage")
  .handle(({ app, input, actor }) =>
    app.createTagForProject({ projectId: input.projectId, name: input.name }, actor),
  )

  .procedure("rename")
  .withPermission("prompts:manage")
  .handle(({ app, input }) =>
    app.renameTagForProject({
      projectId: input.projectId,
      oldName: input.oldName,
      newName: input.newName,
    }),
  )

  .procedure("delete")
  .withPermission("prompts:manage")
  .handle(async ({ app, input }) => {
    await app.deleteTagForProject({ projectId: input.projectId, name: input.name });

    return { success: true };
  })
  .build();
