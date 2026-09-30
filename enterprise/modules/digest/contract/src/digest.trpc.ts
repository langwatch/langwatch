// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The Cloud-admin gallery at /ops/cloud/digests: every procedure is staff-only. */
import { defineTrpcContract } from "@langwatch/kernel/contract";
import { z } from "zod";

import {
  digestAcknowledgedSchema,
  digestCohortInputSchema,
  digestCohortRowSchema,
  digestMemberRowSchema,
  digestMetricRowSchema,
  digestOrganizationInputSchema,
  digestPreviewInputSchema,
  digestPreviewSchema,
  digestSendTestInputSchema,
  digestSetArmedInputSchema,
  digestSetEnrolledInputSchema,
  digestSettingsSchema,
  digestUpdateSchema,
} from "./digest.ts";

export const digestTrpc = defineTrpcContract("digest")
  .query("cohort")
  .withInput(digestCohortInputSchema)
  .withOutput(z.array(digestCohortRowSchema))

  .query("members")
  .withInput(digestOrganizationInputSchema)
  .withOutput(z.array(digestMemberRowSchema))

  .query("preview")
  .withInput(digestPreviewInputSchema)
  .withOutput(digestPreviewSchema)

  .mutation("setEnrolled")
  .withInput(digestSetEnrolledInputSchema)
  .withOutput(digestAcknowledgedSchema)

  .query("updates")
  .withInput(z.object({}))
  .withOutput(z.array(digestUpdateSchema))

  .mutation("saveUpdate")
  .withInput(digestUpdateSchema)
  .withOutput(digestAcknowledgedSchema)

  .query("settings")
  .withInput(z.object({}))
  .withOutput(digestSettingsSchema)

  .mutation("setArmed")
  .withInput(digestSetArmedInputSchema)
  .withOutput(digestSettingsSchema)

  .mutation("sendTest")
  .withInput(digestSendTestInputSchema)
  .withOutput(digestAcknowledgedSchema)

  .query("metrics")
  .withInput(z.object({}))
  .withOutput(z.array(digestMetricRowSchema))
  .build();
