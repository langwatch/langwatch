// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Every `governanceCost.*` procedure served so far, declared once, at main's wire names. */
import { defineTrpcContract } from "@langwatch/api/contract";

import {
  governanceCostDayRecordsSchema,
  governanceCostModelBreakdownSchema,
  governanceCostPeriodRecordsInputSchema,
  governanceCostProviderDayBreakdownSchema,
  governanceCostWindowInputSchema,
  governanceSpenderBreakdownSchema,
} from "./governance-cost.ts";

export const governanceCostTrpc = defineTrpcContract("governanceCost")
  .query("dailyByProvider")
  .withInput(governanceCostWindowInputSchema)
  .withOutput(governanceCostProviderDayBreakdownSchema)

  .query("spendByModel")
  .withInput(governanceCostWindowInputSchema)
  .withOutput(governanceCostModelBreakdownSchema)

  .query("periodRecords")
  .withInput(governanceCostPeriodRecordsInputSchema)
  .withOutput(governanceCostDayRecordsSchema)

  .query("spenders")
  .withInput(governanceCostWindowInputSchema)
  .withOutput(governanceSpenderBreakdownSchema)
  .build();
