// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { z } from "zod";

/** A write whose whole answer is that it happened: a screen refetches, never trusting a row. */
export const enterpriseGatewayWriteAcknowledgedSchema = z.object({ ok: z.boolean() }).strict();
