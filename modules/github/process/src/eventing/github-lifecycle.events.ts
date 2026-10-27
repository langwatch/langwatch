import { EventSchema } from "@langwatch/eventing";
import {
  GITHUB_INSTALLATION_CONNECTED_EVENT_TYPE,
  GITHUB_INSTALLATION_CONNECTED_EVENT_VERSION,
  githubInstallationConnectedEventDataSchema,
} from "@langwatch/github-contract";
import { z } from "zod";

export const RECORD_INSTALLATION_CONNECTED_COMMAND_TYPE =
  "lw.github.record_installation_connected" as const;

export const recordInstallationConnectedCommandDataSchema =
  githubInstallationConnectedEventDataSchema;
export type RecordInstallationConnectedCommandData = z.infer<
  typeof recordInstallationConnectedCommandDataSchema
>;

export const githubInstallationConnectedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(GITHUB_INSTALLATION_CONNECTED_EVENT_TYPE),
  version: z.literal(GITHUB_INSTALLATION_CONNECTED_EVENT_VERSION),
  data: githubInstallationConnectedEventDataSchema,
});
export type GithubInstallationConnectedEvent = z.infer<
  typeof githubInstallationConnectedEventSchema
>;
