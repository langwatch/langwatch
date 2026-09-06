/**
 * The prompt library over the process's tRPC transport.
 *
 * Transport only: gates, input parsing, the cross-project probes copy/push/sync
 * need, and delegation to {@link PromptApp}. Attribution, the not-found
 * refusals and what a copy receives from its source all live on the
 * application, where a second door reaches the same answers.
 */
import { createTrpcService } from "@langwatch/api/trpc";
import type {
  PromptAssignTagTrpcOutput,
  PromptConfigTagsTrpcOutput,
  PromptCreateTrpcOutput,
  PromptGetAllForProjectTrpcOutput,
  PromptGetAllVersionsTrpcOutput,
  PromptGetByIdOrHandleTrpcOutput,
  PromptHandleUniquenessTrpcOutput,
  PromptUpdateHandleTrpcOutput,
  PromptUpdateTrpcOutput,
} from "@langwatch/prompt-contract";
import {
  copiedPromptSchema,
  createPromptCreateTrpcInputSchema,
  createPromptUpdateTrpcInputSchema,
  promptAssignTagTrpcInputSchema,
  promptConfigTagsTrpcInputSchema,
  promptCopyTrpcInputSchema,
  promptGetByIdOrHandleTrpcInputSchema,
  promptHandleUniquenessTrpcInputSchema,
  promptIdOrHandleTrpcInputSchema,
  promptProjectTrpcInputSchema,
  promptPushToCopiesTrpcInputSchema,
  promptRestoreVersionTrpcInputSchema,
  promptUpdateHandleTrpcInputSchema,
  promptCopyChoiceSchema,
  promptDeleteResultSchema,
  promptModifyPermissionSchema,
  promptPushToCopiesResultSchema,
  promptTagAssignmentSchema,
  versionedPromptSchema,
} from "@langwatch/prompt-contract";
import { nodeDatasetSchema } from "@langwatch/workflow-contract";
import { z } from "zod";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { PromptApp, PromptHasNoCopiesError, PromptNoCopiesSelectedError } from "#app/prompt.app";
import type {
  PromptTrpcContext,
  PromptTrpcPorts,
  PromptTrpcProcedures,
} from "../../rules/prompt-trpc-context.rules.ts";

/** Installs the complete `prompts.*` tRPC surface on a process-owned root. */
export class PromptTrpcApi {
  static create<
    TContext extends PromptTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: PromptTrpcProcedures<TContext, TOptions, TRoot>,
    ports: PromptTrpcPorts,
  ) {
    const { protected: procedure, policy, validateOutput } = procedures;
    // Built here rather than in the contract: `demonstrations` is a workflow
    // dataset, and the workflow contract already depends on the prompt one, so
    // the shape takes the schema instead of importing it into a cycle.
    const createInputSchema = createPromptCreateTrpcInputSchema({
      demonstrationsSchema: nodeDatasetSchema,
    });
    const updateInputSchema = createPromptUpdateTrpcInputSchema({
      demonstrationsSchema: nodeDatasetSchema,
    });

    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("getAllPromptsForProject", (p) =>
        p
          .withInput(promptProjectTrpcInputSchema)
          .withOutput(versionedPromptSchema.array())
          .withPermission("prompts:view")
          /** Every prompt in the project. */
          .handle(async ({ ctx, input }): Promise<PromptGetAllForProjectTrpcOutput> =>
            ctx.app.prompts.listForProject(input),
          ),
      )
      .query("getCopies", (p) =>
        p
          .withInput(promptIdOrHandleTrpcInputSchema)
          .withOutput(promptCopyChoiceSchema.array())
          .withPermission("prompts:view")
          /** The copies of a prompt this caller may push to, for the picker. */
          .handle(async ({ ctx, input }) => {
            const prompt = await ctx.app.prompts.getByIdOrHandle({
              idOrHandle: input.idOrHandle,
              projectId: input.projectId,
            });

            const copies = await ctx.app.prompts.listCopies({ sourcePromptId: prompt.id });

            // Each copy lives in a SECOND project this input names, which the
            // declared check does not cover, so the caller's standing there is
            // probed one copy at a time.
            const copiesWithPermissions = await Promise.all(
              copies.map(async (copy) => {
                const hasPermission = await ctx.can("prompts:update", {
                  projectId: copy.projectId,
                });
                return {
                  id: copy.id,
                  handle: copy.handle ?? copy.id,
                  projectId: copy.projectId,
                  projectName: copy.projectName,
                  teamName: copy.teamName,
                  organizationName: copy.organizationName,
                  fullPath: `${copy.organizationName} / ${copy.teamName} / ${copy.projectName}`,
                  hasPermission,
                };
              }),
            );

            return copiesWithPermissions.filter((copy) => copy.hasPermission);
          }),
      )
      .mutation("restoreVersion", (p) =>
        p
          .withInput(promptRestoreVersionTrpcInputSchema)
          .withOutput(versionedPromptSchema)
          .withPermission("prompts:update")
          .handle(async ({ ctx, input }) => ctx.app.prompts.restoreVersion(input, ctx.actor())),
      )
      .mutation("create", (p) =>
        p
          .withInput(createInputSchema)
          .withOutput(versionedPromptSchema)
          .withPermission("prompts:create")
          .handle(async ({ ctx, input }): Promise<PromptCreateTrpcOutput> => {
            const author = ctx.actor();

            const result = await ctx.app.prompts.create(
              { ...input.data, projectId: input.projectId },
              author,
            );

            ports.afterPromptCreated({ projectId: input.projectId, userId: author.id });

            return result;
          }),
      )
      .mutation("update", (p) =>
        p
          .withInput(updateInputSchema)
          .withOutput(versionedPromptSchema)
          .withPermission("prompts:update")
          /**
           * A new version, so a commit message is required. Handle and scope do
           * NOT travel here: they create no version and need no message, and
           * `updateHandle` is the door for them.
           */
          .handle(async ({ ctx, input }): Promise<PromptUpdateTrpcOutput> =>
            ctx.app.prompts.update(
              { idOrHandle: input.id, projectId: input.projectId, data: input.data },
              ctx.actor(),
            ),
          ),
      )
      .mutation("updateHandle", (p) =>
        p
          .withInput(promptUpdateHandleTrpcInputSchema)
          .withOutput(versionedPromptSchema)
          .withPermission("prompts:update")
          /** The handle and scope alone, with no new version. */
          .handle(async ({ ctx, input }): Promise<PromptUpdateHandleTrpcOutput> =>
            ctx.app.prompts.updateHandle({
              idOrHandle: input.id,
              projectId: input.projectId,
              data: input.data,
            }),
          ),
      )
      .query("getByIdOrHandle", (p) =>
        p
          .withInput(promptGetByIdOrHandleTrpcInputSchema)
          .withOutput(versionedPromptSchema.nullable())
          .withPermission("prompts:view")
          /**
           * A `NotFoundError` is a `HandledError` carrying `prompt_not_found`,
           * and an invalid tag reference one carrying `prompt_tag_invalid`. Both
           * are raised by the application, `handledErrorMiddleware` maps them to
           * their statuses and the client reads its copy off the code, so there
           * is nothing here to re-wrap.
           */
          .handle(async ({ ctx, input }): Promise<PromptGetByIdOrHandleTrpcOutput> =>
            ctx.app.prompts.tryGetByIdOrHandle(input),
          ),
      )
      .query("checkHandleUniqueness", (p) =>
        p
          .withInput(promptHandleUniquenessTrpcInputSchema)
          .withOutput(z.boolean())
          .withPermission("prompts:view")
          .handle(async ({ ctx, input }): Promise<PromptHandleUniquenessTrpcOutput> =>
            ctx.app.prompts.checkHandleUniqueness(input),
          ),
      )
      .query("checkModifyPermission", (p) =>
        p
          .withInput(promptIdOrHandleTrpcInputSchema)
          .withOutput(promptModifyPermissionSchema)
          .withPermission("prompts:view")
          .handle(async ({ ctx, input }) => ctx.app.prompts.checkModifyPermission(input)),
      )
      .query("getAllVersionsForPrompt", (p) =>
        p
          .withInput(promptIdOrHandleTrpcInputSchema)
          .withOutput(versionedPromptSchema.array())
          .withPermission("prompts:view")
          .handle(async ({ ctx, input }): Promise<PromptGetAllVersionsTrpcOutput> =>
            ctx.app.prompts.listVersions(input),
          ),
      )
      .mutation("delete", (p) =>
        p
          .withInput(promptIdOrHandleTrpcInputSchema)
          .withOutput(promptDeleteResultSchema)
          .withPermission("prompts:delete")
          .handle(async ({ ctx, input }) => ctx.app.prompts.delete(input)),
      )
      .mutation("copy", (p) =>
        p
          .withInput(promptCopyTrpcInputSchema)
          .withOutput(copiedPromptSchema)
          .withPermission("prompts:create")
          /** Copies a prompt into another project. */
          .handle(async ({ ctx, input }) => {
            // The SOURCE project is a second project this input names, which
            // the declared check does not cover.
            const hasSourcePermission = await ctx.can("prompts:create", {
              projectId: input.sourceProjectId,
            });

            if (!hasSourcePermission) {
              // Left as a raw TRPCError deliberately.
              // `ProjectPermissionDeniedError` is the right handled shape for
              // this, and it is a 403 — this refusal has always answered
              // UNAUTHORIZED (401). Converting it moves the wire status, which
              // is a behaviour change the client's sign-in handling can see, so
              // it is reported rather than taken here. The same holds for the
              // two below.
              throw new TRPCError({
                code: "UNAUTHORIZED",
                message: "You do not have permission to create prompts in the source project",
              });
            }

            const author = ctx.actor();

            // A missing source prompt raises `prompt_not_found`, a HandledError:
            // `handledErrorMiddleware` gives it the NOT_FOUND tRPC code and the
            // client reads its copy off that code. Nothing to re-wrap.
            const copiedPrompt = await ctx.app.prompts.copyToProject(
              {
                idOrHandle: input.idOrHandle,
                sourceProjectId: input.sourceProjectId,
                targetProjectId: input.projectId,
              },
              author,
            );

            ports.afterPromptCreated({ projectId: input.projectId, userId: author.id });

            return copiedPrompt;
          }),
      )
      .mutation("duplicate", (p) =>
        p
          .withInput(promptIdOrHandleTrpcInputSchema)
          .withOutput(versionedPromptSchema)
          .withPermission("prompts:create")
          /**
           * Duplicates a prompt inside the project it already belongs to.
           * Unlike `copy`, this never crosses a project boundary.
           */
          .handle(async ({ ctx, input }) => {
            const author = ctx.actor();

            const duplicatedPrompt = await ctx.app.prompts.duplicate(
              { idOrHandle: input.idOrHandle, projectId: input.projectId },
              author,
            );

            ports.afterPromptCreated({ projectId: input.projectId, userId: author.id });

            return duplicatedPrompt;
          }),
      )
      .mutation("syncFromSource", (p) =>
        p
          .withInput(promptIdOrHandleTrpcInputSchema)
          .withOutput(versionedPromptSchema)
          .withPermission("prompts:update")
          /** Brings a copied prompt back in line with its source. */
          .handle(async ({ ctx, input }) => {
            const author = ctx.actor();

            // The copy. A missing one raises `prompt_not_found`; a prompt that
            // was never copied from anywhere raises `prompt_not_a_copy`.
            const copy = await ctx.app.prompts.getByIdOrHandle({
              idOrHandle: input.idOrHandle,
              projectId: input.projectId,
            });
            const copySource = await ctx.app.prompts.getCopySource({ promptId: copy.id });

            // The declared check gated the copy's project; the source is a
            // SECOND project this input names, so it is probed here.
            const hasSourcePermission = await ctx.can("prompts:view", {
              projectId: copySource.sourceProjectId,
            });

            if (!hasSourcePermission) {
              throw new TRPCError({
                code: "UNAUTHORIZED",
                message: "You do not have permission to view prompts in the source project",
              });
            }

            const source = await ctx.app.prompts.getByIdOrHandle({
              idOrHandle: copySource.sourcePromptId,
              projectId: copySource.sourceProjectId,
            });

            return ctx.app.prompts.applySourceToCopy(
              {
                source,
                targetIdOrHandle: input.idOrHandle,
                targetProjectId: input.projectId,
                commitMessage: PromptApp.commitMessageFor("synced", source),
              },
              author,
            );
          }),
      )
      .mutation("pushToCopies", (p) =>
        p
          .withInput(promptPushToCopiesTrpcInputSchema)
          .withOutput(promptPushToCopiesResultSchema)
          .withPermission("prompts:update")
          /** Pushes a source prompt out to the copies made from it. */
          .handle(async ({ ctx, input }) => {
            const author = ctx.actor();

            const source = await ctx.app.prompts.getByIdOrHandle({
              idOrHandle: input.idOrHandle,
              projectId: input.projectId,
            });

            const copies = await ctx.app.prompts.listCopies({ sourcePromptId: source.id });
            if (copies.length === 0) throw new PromptHasNoCopiesError();

            const copiesToPush = input.copyIds
              ? copies.filter((copy) => input.copyIds!.includes(copy.id))
              : copies;

            if (copiesToPush.length === 0) throw new PromptNoCopiesSelectedError();

            const commitMessage = PromptApp.commitMessageFor("pushed", source);
            const results = [];

            for (const copy of copiesToPush) {
              // Each copy lives in a SECOND project this input names, so the
              // declared check does not cover it; a copy the caller cannot
              // update is skipped rather than failing the whole push.
              const hasCopyPermission = await ctx.can("prompts:update", {
                projectId: copy.projectId,
              });
              if (!hasCopyPermission) continue;

              const updated = await ctx.app.prompts.applySourceToCopy(
                {
                  source,
                  targetIdOrHandle: copy.id,
                  targetProjectId: copy.projectId,
                  commitMessage,
                },
                author,
              );

              results.push({
                copyId: copy.id,
                copyName: copy.handle ?? copy.id,
                prompt: updated,
              });
            }

            if (results.length === 0) {
              throw new TRPCError({
                code: "UNAUTHORIZED",
                message: "You do not have permission to update any of the copied prompts",
              });
            }

            return {
              pushedTo: results.length,
              totalCopies: copies.length,
              selectedCopies: copiesToPush.length,
              results,
            };
          }),
      )
      .query("getTagsForConfig", (p) =>
        p
          .withInput(promptConfigTagsTrpcInputSchema)
          .withOutput(promptTagAssignmentSchema.array())
          .withPermission("prompts:view")
          /** Every tag assigned to one prompt config. */
          .handle(async ({ ctx, input }): Promise<PromptConfigTagsTrpcOutput> =>
            ctx.app.prompts.getTagsForConfig({
              configId: input.configId,
              projectId: input.projectId,
            }),
          ),
      )
      .mutation("assignTag", (p) =>
        p
          .withInput(promptAssignTagTrpcInputSchema)
          .withOutput(promptTagAssignmentSchema)
          .withPermission("prompts:update")
          /**
           * Assigns — or moves — a tag onto one prompt version. Takes the
           * built-in tags and any the organization has defined.
           */
          .handle(async ({ ctx, input }): Promise<PromptAssignTagTrpcOutput> =>
            ctx.app.prompts.assignTag(
              {
                configId: input.configId,
                versionId: input.versionId,
                tag: input.tag,
                projectId: input.projectId,
              },
              ctx.actor(),
            ),
          ),
      )
      .build();
  }
}
