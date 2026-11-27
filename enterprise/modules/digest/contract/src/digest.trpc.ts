// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The weekly digest: the operator controls in Cloud admin are staff-only; the preference pair is
 * the signed-in person's own opt-out.
 */
import { defineTrpcContract } from "@langwatch/module";

import {
  digestAcknowledgedSchema,
  digestMyTestsSchema,
  digestNoInputSchema,
  digestPreferenceSchema,
  digestSendTestForInputSchema,
  digestSendTestInputSchema,
  digestSetArmedInputSchema,
  digestSettingsSchema,
  digestTestsForSchema,
} from "./digest.ts";

export const digestTrpc = defineTrpcContract("digest")
  .mutation("setArmed")
  .withInput(digestSetArmedInputSchema)
  .withOutput(digestSettingsSchema)

  .mutation("sendTest")
  .withInput(digestSendTestInputSchema)
  .withOutput(digestAcknowledgedSchema)

  .mutation("sendMyTests")
  .withInput(digestNoInputSchema)
  .withOutput(digestMyTestsSchema)

  .mutation("sendTestFor")
  .withInput(digestSendTestForInputSchema)
  .withOutput(digestTestsForSchema)

  .query("getMyPreference")
  .withInput(digestNoInputSchema)
  .withOutput(digestPreferenceSchema)

  .mutation("setMyPreference")
  .withInput(digestPreferenceSchema)
  .withOutput(digestPreferenceSchema)
  .build();
