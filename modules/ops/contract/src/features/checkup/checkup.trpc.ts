/**
 * Settings, Checkup on a self-hosted install. Every procedure answers
 * `{ deployment: "saas" }` on LangWatch Cloud, where the page is not linked.
 */
import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

import { usageReportPreviewSchema } from "./checkup-usage-report.ts";
import { checkupResultSchema, explicitCheckInputSchema } from "./checkup.ts";

const organizationInput = z.object({ organizationId: z.string().min(1) });

const onCloud = z.object({ deployment: z.literal("saas") });

const selfHosted = { deployment: z.literal("self-hosted") };

/** A checkup, or the answer a LangWatch Cloud install gives instead. */
const checkupAnswerSchemaDefinition = z.union([
  onCloud,
  z.object({ ...checkupResultSchema.shape, ...selfHosted }),
]);
export interface CheckupAnswerSchema extends Named<typeof checkupAnswerSchemaDefinition> {}
export const checkupAnswerSchema: CheckupAnswerSchema = checkupAnswerSchemaDefinition;
export type CheckupAnswer = z.infer<typeof checkupAnswerSchema>;

/** The usage report preview, or the answer a LangWatch Cloud install gives instead. */
const usageReportAnswerSchemaDefinition = z.union([
  onCloud,
  z.object({ ...usageReportPreviewSchema.shape, ...selfHosted }),
]);
export interface UsageReportAnswerSchema extends Named<typeof usageReportAnswerSchemaDefinition> {}
export const usageReportAnswerSchema: UsageReportAnswerSchema = usageReportAnswerSchemaDefinition;
export type UsageReportAnswer = z.infer<typeof usageReportAnswerSchema>;

const checkupAnswer = checkupAnswerSchema;
const usageReportAnswer = usageReportAnswerSchema;

export const checkupTrpc = defineTrpcContract("checkup")
  .query("status")
  .withInput(organizationInput)
  .withOutput(checkupAnswer)

  .mutation("run")
  .withInput(z.object({ ...organizationInput.shape, ...explicitCheckInputSchema.shape }))
  .withOutput(checkupAnswer)

  .query("usageReport")
  .withInput(organizationInput)
  .withOutput(usageReportAnswer)

  .mutation("setUsageReportSwitches")
  .withInput(
    z.object({
      ...organizationInput.shape,
      optionalMetricsOptOut: z.boolean().optional(),
      hostnameOptOut: z.boolean().optional(),
    }),
  )
  .withOutput(usageReportAnswer)
  .build();
