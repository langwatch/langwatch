// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The weekly digest's operator controls in Cloud admin: every procedure is staff-only. */
import { defineTrpcContract } from "@langwatch/module";

import {
  digestAcknowledgedSchema,
  digestSendTestInputSchema,
  digestSetArmedInputSchema,
  digestSetEnrolledInputSchema,
  digestSettingsSchema,
} from "./digest.ts";

export const digestTrpc = defineTrpcContract("digest")
  .mutation("setEnrolled")
  .withInput(digestSetEnrolledInputSchema)
  .withOutput(digestSettingsSchema)

  .mutation("setArmed")
  .withInput(digestSetArmedInputSchema)
  .withOutput(digestSettingsSchema)

  .mutation("sendTest")
  .withInput(digestSendTestInputSchema)
  .withOutput(digestAcknowledgedSchema)
  .build();
