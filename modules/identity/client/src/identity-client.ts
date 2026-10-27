/** The hooks Identity's own contract generates, and what each procedure takes and answers. */

import {
  type ContractApiMap,
  createModuleApi,
  type ModuleApi,
  type OutputsFromMap,
} from "@langwatch/api/web";
import type {
  identityLookupTrpc,
  identityTrpc,
  joinRequestTrpc,
  twoStepVerificationTrpc,
} from "@langwatch/identity-contract";

type IdentityApiMap = ContractApiMap<typeof identityTrpc> &
  ContractApiMap<typeof joinRequestTrpc> &
  ContractApiMap<typeof identityLookupTrpc> &
  ContractApiMap<typeof twoStepVerificationTrpc>;

export const identityClient: ModuleApi<IdentityApiMap> = createModuleApi<IdentityApiMap>();

type InputsOf<TNode> = TNode extends { query: { input: infer TIn } }
  ? TIn
  : TNode extends { mutation: { input: infer TIn } }
    ? TIn
    : TNode extends { subscription: { input: infer TIn } }
      ? TIn
      : { [K in keyof TNode]: InputsOf<TNode[K]> };

/** What each procedure takes, as the browser sends it. */
export type IdentityInputs = { [K in keyof IdentityApiMap]: InputsOf<IdentityApiMap[K]> };

/** What each procedure answers, as the browser receives it. */
export type IdentityOutputs = OutputsFromMap<IdentityApiMap>;
