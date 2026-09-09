/**
 * Every `licenseEnforcement.*` procedure, declared once. The report answers
 * nothing: the upgrade dialog is already on screen and the alert it raises is
 * a side effect nobody waits on.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { allLimitChecksSchema, limitCheckResultSchema, limitTypeSchema } from "./license-limit-type.ts";

/** The organization a limit is measured against. */
const organizationScopeSchema = z.object({ organizationId: z.string() });

/** One named limit, measured against one organization. */
const limitScopeSchema = z.object({
  organizationId: z.string(),
  limitType: limitTypeSchema,
});

export const licenseEnforcementTrpc = defineTrpcContract("licenseEnforcement")
  .query("checkLimit")
  .withInput(limitScopeSchema)
  .withOutput(limitCheckResultSchema)

  /**
   * WHICH limits "every limit" means is the application's: a list enumerated
   * here would go stale the day a limit is added, and show one fewer.
   */
  .query("checkAllLimits")
  .withInput(organizationScopeSchema)
  .withOutput(allLimitChecksSchema)

  .mutation("reportLimitBlocked")
  .withInput(limitScopeSchema)
  .build();
