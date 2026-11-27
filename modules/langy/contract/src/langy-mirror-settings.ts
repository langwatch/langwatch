/**
 * Where this deployment mirrors Langy's own traces: the project id only, a non-secret setting a
 * staff investigation reads (ADR-202). The mirror's key never leaves the config.
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

const langyMirrorSettingsSchemaDefinition = z.object({
  /** Null when no mirror project is set, so nothing is mirrored. */
  projectId: z.string().nullable(),
});
export interface LangyMirrorSettingsSchema extends Named<
  typeof langyMirrorSettingsSchemaDefinition
> {}
export const langyMirrorSettingsSchema: LangyMirrorSettingsSchema =
  langyMirrorSettingsSchemaDefinition;
export type LangyMirrorSettings = z.infer<typeof langyMirrorSettingsSchema>;
