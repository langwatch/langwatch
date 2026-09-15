/**
 * Every `virtualKeys.*` procedure, declared once. Organization-scoped, and
 * authorized per scope in the resolver, because the scopes a key lives in are
 * data. The plaintext key crosses the wire only on create and rotate.
 */

import { defineTrpcContract } from "@langwatch/api/contract";

import {
  virtualKeyApiApplicableBudgetsInputSchema,
  virtualKeyApiCreateInputSchema,
  virtualKeyApiDisableInputSchema,
  virtualKeyApiKeyInputSchema,
  virtualKeyApiOrganizationInputSchema,
  virtualKeyApiUpdateInputSchema,
} from "./virtual-key.schemas.ts";
import {
  virtualKeyApplicableBudgetsSchema,
  virtualKeyCamelDtoSchema,
  virtualKeyMintedSchema,
  virtualKeySpendThisMonthSchema,
} from "./gateway.responses.ts";

export const virtualKeyTrpc = defineTrpcContract("virtualKeys")
  .query("list")
  .withInput(virtualKeyApiOrganizationInputSchema)
  .withOutput(virtualKeyCamelDtoSchema.array())

  .query("get")
  .withInput(virtualKeyApiKeyInputSchema)
  .withOutput(virtualKeyCamelDtoSchema)

  /** Spend this calendar month per visible key, beside its own direct cap. */
  .query("spendThisMonth")
  .withInput(virtualKeyApiOrganizationInputSchema)
  .withOutput(virtualKeySpendThisMonthSchema)

  /** Every budget that would constrain a draft or an existing key. */
  .query("applicableBudgets")
  .withInput(virtualKeyApiApplicableBudgetsInputSchema)
  .withOutput(virtualKeyApplicableBudgetsSchema)

  .mutation("create")
  .withInput(virtualKeyApiCreateInputSchema)
  .withOutput(virtualKeyMintedSchema)

  .mutation("update")
  .withInput(virtualKeyApiUpdateInputSchema)
  .withOutput(virtualKeyCamelDtoSchema)

  .mutation("rotate")
  .withInput(virtualKeyApiKeyInputSchema)
  .withOutput(virtualKeyMintedSchema)

  .mutation("revoke")
  .withInput(virtualKeyApiKeyInputSchema)
  .withOutput(virtualKeyCamelDtoSchema)

  .mutation("disable")
  .withInput(virtualKeyApiDisableInputSchema)
  .withOutput(virtualKeyCamelDtoSchema)

  .mutation("enable")
  .withInput(virtualKeyApiKeyInputSchema)
  .withOutput(virtualKeyCamelDtoSchema)
  .build();
