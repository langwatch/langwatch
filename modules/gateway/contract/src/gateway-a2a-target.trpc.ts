/** Every `gatewayA2aTargets.*` procedure. The gateway reads targets through the config bundle. */
import { defineTrpcContract } from "@langwatch/module";
import { z } from "zod";

import {
  createGatewayA2aTargetInputSchema,
  gatewayA2aTargetDtoSchema,
  setGatewayA2aTargetBlockedInputSchema,
  updateGatewayA2aTargetInputSchema,
} from "./gateway-a2a-target.ts";

const targetIdSchema = z.object({ organizationId: z.string(), id: z.string() });

export const gatewayA2aTargetTrpc = defineTrpcContract("gatewayA2aTargets")
  .query("list")
  .withInput(z.object({ organizationId: z.string() }))
  .withOutput(gatewayA2aTargetDtoSchema.array())

  .mutation("create")
  .withInput(createGatewayA2aTargetInputSchema.omit({ actorUserId: true }))
  .withOutput(gatewayA2aTargetDtoSchema)

  .mutation("update")
  .withInput(updateGatewayA2aTargetInputSchema.omit({ actorUserId: true }))
  .withOutput(gatewayA2aTargetDtoSchema)

  .mutation("setBlocked")
  .withInput(setGatewayA2aTargetBlockedInputSchema.omit({ actorUserId: true }))
  .withOutput(gatewayA2aTargetDtoSchema)

  .mutation("delete")
  .withInput(targetIdSchema)
  .withOutput(gatewayA2aTargetDtoSchema)
  .build();
