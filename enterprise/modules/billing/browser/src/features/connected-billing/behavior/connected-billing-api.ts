// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type { connectedBillingTrpc } from "@langwatch/enterprise-billing-contract";

/** `connectedBilling.*`, derived from the contract's declarations. */
export const connectedBillingApi = createModuleApi<ContractApiMap<typeof connectedBillingTrpc>>();
