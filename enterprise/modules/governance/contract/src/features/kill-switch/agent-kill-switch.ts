// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The AWS connections governance signs AWS calls with: an AWS source's agent listing, and the
 * kill switch's Bedrock targets. Served as `governanceKillSwitch.*`.
 * Spec: enterprise/modules/governance/specs/cloud-agent-discovery.feature
 */
import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

// ── AWS connections ────────────────────────────────────────────────────────

/** A static key pair, a role to assume, or both (the pair signs the AssumeRole call). */
const awsConnectionInputSchemaDefinition = z
  .object({
    name: z.string().trim().min(1).max(80),
    accessKeyId: z.string().trim().min(16).max(128).optional(),
    secretAccessKey: z.string().trim().min(16).max(256).optional(),
    roleArn: z
      .string()
      .regex(/^arn:aws[a-z-]*:iam::\d{12}:role\/.+$/, "an IAM role ARN")
      .optional(),
    externalId: z.string().min(2).max(1224).optional(),
  })
  .refine((input) => Boolean(input.accessKeyId) === Boolean(input.secretAccessKey), {
    message: "an access key id and its secret come together",
    path: ["secretAccessKey"],
  })
  .refine((input) => Boolean(input.accessKeyId) || Boolean(input.roleArn), {
    message: "an access key pair or a role ARN is required",
    path: ["roleArn"],
  });
export interface AwsConnectionInputSchema extends Named<
  typeof awsConnectionInputSchemaDefinition
> {}
export const awsConnectionInputSchema: AwsConnectionInputSchema =
  awsConnectionInputSchemaDefinition;
export type AwsConnectionInput = z.infer<typeof awsConnectionInputSchema>;

/** What a read answers: never the secret, only the access key id's last four characters. */
const awsConnectionViewSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  accessKeyIdLastFour: z.string().nullable(),
  roleArn: z.string().nullable(),
  hasExternalId: z.boolean(),
  createdAt: z.string(),
});
export interface AwsConnectionViewSchema extends Named<typeof awsConnectionViewSchemaDefinition> {}
export const awsConnectionViewSchema: AwsConnectionViewSchema = awsConnectionViewSchemaDefinition;
export type AwsConnectionView = z.infer<typeof awsConnectionViewSchema>;

const organizationScope = { organizationId: z.string() };

export const governanceKillSwitchTrpc = defineTrpcContract("governanceKillSwitch")
  .query("awsConnections")
  .withInput(z.object(organizationScope))
  .withOutput(awsConnectionViewSchema.array())

  .mutation("createAwsConnection")
  .withInput(z.object({ ...organizationScope, connection: awsConnectionInputSchema }))
  .withOutput(awsConnectionViewSchema)

  .mutation("deleteAwsConnection")
  .withInput(z.object({ ...organizationScope, connectionId: z.string().min(1) }))
  .withOutput(z.object({ deleted: z.boolean() }))
  .build();
