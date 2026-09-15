/**
 * The server half of `promptTags.*`. A tag definition is one organization row
 * whose assignments cascade across that organization, so the project the caller
 * named is only the first scope a rename or a delete reaches; which projects,
 * and the refusal, belong to the application.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { PromptApi, promptTagTrpc } from "@langwatch/prompt-contract";

/**
 * The organization-wide guard. Its refusal is `PermissionDeniedError`, a
 * handled 403 the runtime renders as FORBIDDEN with the domain error as the
 * cause, so nothing here re-wraps it.
 */
function assertMayManageEveryProject(
  app: PromptApi,
  input: { projectId: string; userId: string },
): Promise<void> {
  return app.assertMayManageTagCatalog({
    projectId: input.projectId,
    by: { type: "user", userId: input.userId },
  });
}

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
  .handle(async ({ app, input, actor }) => {
    await assertMayManageEveryProject(app, {
      projectId: input.projectId,
      userId: actor.id,
    });

    return app.renameTagForProject({
      projectId: input.projectId,
      oldName: input.oldName,
      newName: input.newName,
    });
  })

  .procedure("delete")
  .withPermission("prompts:manage")
  .handle(async ({ app, input, actor }) => {
    await assertMayManageEveryProject(app, {
      projectId: input.projectId,
      userId: actor.id,
    });
    await app.deleteTagForProject({ projectId: input.projectId, name: input.name });

    return { success: true };
  })
  .build();
