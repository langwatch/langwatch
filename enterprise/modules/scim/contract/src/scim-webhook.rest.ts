// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The two headers an Auth0 SCIM log-stream delivery is admitted by, as the process reads them. */
import { z } from "zod";

export const scimWebhookDeliveryHeadersSchema = z.object({
  signature: z.string().nullable(),
  authorization: z.string().nullable(),
});
