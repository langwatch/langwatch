// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Every `connect.*` procedure, declared once: what a self-hosted install's
 * Settings, Connect page reads and writes (ADR-156, section 9).
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  connectCapSetSchema,
  connectServicesSetSchema,
  connectStatusSchema,
} from "./connect-install.ts";
import { CONNECT_SERVICES } from "./connect-services.ts";

const organizationInput = z.object({ organizationId: z.string().min(1) });

export const connectTrpc = defineTrpcContract("connect")
  .query("status")
  .withInput(organizationInput)
  .withOutput(connectStatusSchema)

  .mutation("setService")
  .withInput(
    z.object({
      ...organizationInput.shape,
      service: z.enum(CONNECT_SERVICES),
      enabled: z.boolean(),
    }),
  )
  .withOutput(connectServicesSetSchema)

  .mutation("setCap")
  .withInput(z.object({ ...organizationInput.shape, capUsd: z.number().positive().finite() }))
  .withOutput(connectCapSetSchema)
  .build();
