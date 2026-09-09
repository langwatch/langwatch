/**
 * The server half of `prompts.*`: the permission each procedure declares, and
 * one call into the application. Attribution, the refusals and the cross-project
 * probes all live there, where the REST door reaches the same answers.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { PromptApi, promptTrpc } from "@langwatch/prompt-contract";

// Copy, push and sync each reach a SECOND project this input names, which the
// declared check does not cover. The application probes it and raises
// `PermissionDeniedError`, a handled 403 the runtime renders as FORBIDDEN with
// the domain error intact - so there is nothing here to re-wrap.

export const promptTrpcTransport = defineTrpcRouter(PromptApi, promptTrpc)
  .procedure("getAllPromptsForProject")
  .withPermission("prompts:view")
  .handle(({ app, input }) => app.listForProject(input))

  .procedure("getCopies")
  .withPermission("prompts:view")
  .handle(({ app, input, actor }) => app.listCopyTargets(input, actor))

  .procedure("restoreVersion")
  .withPermission("prompts:update")
  .handle(({ app, input, actor }) => app.restoreVersion(input, actor))

  .procedure("create")
  .withPermission("prompts:create")
  .handle(async ({ app, input, actor }) => {
    const created = await app.create({ ...input.data, projectId: input.projectId }, actor);

    app.announceCreated({ projectId: input.projectId, userId: actor.id });

    return created;
  })

  .procedure("update")
  .withPermission("prompts:update")
  .handle(({ app, input, actor }) =>
    app.update(
      { idOrHandle: input.id, projectId: input.projectId, data: input.data },
      actor,
    ),
  )

  .procedure("updateHandle")
  .withPermission("prompts:update")
  .handle(({ app, input }) =>
    app.updateHandle({
      idOrHandle: input.id,
      projectId: input.projectId,
      data: input.data,
    }),
  )

  // A missing prompt raises `prompt_not_found` and an invalid tag reference
  // `prompt_tag_invalid`, both handled errors the client reads its copy off.
  .procedure("getByIdOrHandle")
  .withPermission("prompts:view")
  .handle(({ app, input }) => app.tryGetByIdOrHandle(input))

  .procedure("checkHandleUniqueness")
  .withPermission("prompts:view")
  .handle(({ app, input }) => app.checkHandleUniqueness(input))

  .procedure("checkModifyPermission")
  .withPermission("prompts:view")
  .handle(({ app, input }) => app.checkModifyPermission(input))

  .procedure("getAllVersionsForPrompt")
  .withPermission("prompts:view")
  .handle(({ app, input }) => app.listVersions(input))

  .procedure("delete")
  .withPermission("prompts:delete")
  .handle(({ app, input }) => app.delete(input))

  .procedure("copy")
  .withPermission("prompts:create")
  .handle(async ({ app, input, actor }) => {
    const copied = await app.copyFromProject(
      {
        idOrHandle: input.idOrHandle,
        sourceProjectId: input.sourceProjectId,
        targetProjectId: input.projectId,
      },
      actor,
    );

    app.announceCreated({ projectId: input.projectId, userId: actor.id });

    return copied;
  })

  .procedure("duplicate")
  .withPermission("prompts:create")
  .handle(async ({ app, input, actor }) => {
    const duplicated = await app.duplicate(
      { idOrHandle: input.idOrHandle, projectId: input.projectId },
      actor,
    );

    app.announceCreated({ projectId: input.projectId, userId: actor.id });

    return duplicated;
  })

  .procedure("syncFromSource")
  .withPermission("prompts:update")
  .handle(({ app, input, actor }) => app.syncFromSource(input, actor))

  .procedure("pushToCopies")
  .withPermission("prompts:update")
  .handle(({ app, input, actor }) => app.pushToCopies(input, actor))

  .procedure("getTagsForConfig")
  .withPermission("prompts:view")
  .handle(({ app, input }) =>
    app.getTagsForConfig({ configId: input.configId, projectId: input.projectId }),
  )

  .procedure("assignTag")
  .withPermission("prompts:update")
  .handle(({ app, input, actor }) =>
    app.assignTag(
      {
        configId: input.configId,
        versionId: input.versionId,
        tag: input.tag,
        projectId: input.projectId,
      },
      actor,
    ),
  )
  .build();
