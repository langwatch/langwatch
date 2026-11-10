/**
 * Retention carried to rows already stored: an extension (activation or save) or an apply request,
 * then one rewrite per project and category under the scope, each recorded as applied.
 * Specs: specs/billing/seat-subscription-retention-policy.feature, retention-apply-to-stored-data
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";

import type { DataRetentionModule } from "../app/data-retention.app.ts";
import type { DataRetentionRepositories } from "../repositories/data-retention.repositories.ts";
import type { RetentionExtensionService } from "../services/retention-extension.service.ts";
import {
  ApplyRetentionExtensionCommand,
  RecordRetentionExtensionCommand,
  RequestStoredRetentionApplyCommand,
} from "./retention-extension.commands.ts";
import {
  retentionAppliedEventSchema,
  retentionExtendedEventSchema,
  RETENTION_EXTENSION_AGGREGATE_TYPE,
  RETENTION_EXTENSION_PIPELINE_NAME,
  storedRetentionApplyRequestedEventSchema,
} from "./retention-extension.events.ts";
import {
  RETENTION_EXTENSION_APPLY_INITIAL_STATE,
  RETENTION_EXTENSION_APPLY_PROCESS_NAME,
  retentionExtended,
  storedRetentionApplyRequested,
  retentionExtensionApplySchema,
  retentionExtensionApplyStateSchema,
} from "./retention-extension.process.ts";

export interface RetentionExtensionPipelineDeps {
  applyCommand: ApplyRetentionExtensionCommand;
  extensions: Pick<RetentionExtensionService, "applyToProjects">;
  /** The fan-out's backoff; tests shorten it, the deployment keeps the default. */
  applyRetryDelayMs?: (params: { attempt: number }) => number;
}

const APPLY_MAX_ATTEMPTS = 8;
const applyRetryDelayMs = ({ attempt }: { attempt: number }): number =>
  Math.min(30_000 * 2 ** (attempt - 1), 30 * 60_000);

const defineRetentionExtensionPipeline = (deps: RetentionExtensionPipelineDeps) =>
  definePipeline({
    name: RETENTION_EXTENSION_PIPELINE_NAME,
    aggregate: defineAggregate({ type: RETENTION_EXTENSION_AGGREGATE_TYPE }),
  })
    .withEvents([
      retentionExtendedEventSchema,
      retentionAppliedEventSchema,
      storedRetentionApplyRequestedEventSchema,
    ])
    .withCommand("recordRetentionExtension", RecordRetentionExtensionCommand)
    .withCommand("requestStoredRetentionApply", RequestStoredRetentionApplyCommand)
    .withCommandInstance({
      name: "applyRetentionExtension",
      handlerClass: ApplyRetentionExtensionCommand,
      instance: deps.applyCommand,
    })
    .withProcessManager(RETENTION_EXTENSION_APPLY_PROCESS_NAME, (pm) =>
      pm
        .state(retentionExtensionApplyStateSchema, RETENTION_EXTENSION_APPLY_INITIAL_STATE)
        .intent("applyToProjects", retentionExtensionApplySchema, (payload) =>
          deps.extensions.applyToProjects(payload),
        )
        .on(retentionExtendedEventSchema, retentionExtended)
        .on(storedRetentionApplyRequestedEventSchema, storedRetentionApplyRequested)
        // The fan-out only sends commands; a rerun resends them and each raise's key absorbs it.
        .outbox({
          maxAttempts: APPLY_MAX_ATTEMPTS,
          retryDelayMs: deps.applyRetryDelayMs ?? applyRetryDelayMs,
          concurrency: 2,
          batchSize: 2,
        }),
    )
    .build();

export type RetentionExtensionPipelineDefinition = ReturnType<
  typeof defineRetentionExtensionPipeline
>;

export function buildRetentionExtensionPipeline(
  deps: RetentionExtensionPipelineDeps,
): RetentionExtensionPipelineDefinition {
  return defineRetentionExtensionPipeline(deps);
}

export const retentionExtensionEventing = defineEventingModule({
  pipeline: RETENTION_EXTENSION_PIPELINE_NAME,
  build: ({ app }: EventingSetup<DataRetentionRepositories, DataRetentionModule>) =>
    app.retentionExtensionPipeline(),
  connect: ({ app, commands }) => app.connectRetentionExtensionCommands(commands),
});
