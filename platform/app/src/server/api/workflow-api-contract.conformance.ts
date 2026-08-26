import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { WorkflowApiRouter } from "@langwatch/platform-api-contract";

import type { AppRouter } from "./root";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft ? 1 : 2
      ? true
      : false
    : false;

type Expect<T extends true> = T;
type ApiInputs = inferRouterInputs<AppRouter>["workflow"];
type ContractInputs = inferRouterInputs<WorkflowApiRouter>["workflow"];
type ApiOutputs = inferRouterOutputs<AppRouter>["workflow"];
type ContractOutputs = inferRouterOutputs<WorkflowApiRouter>["workflow"];

type EngineModeInputConforms = Expect<
  Equal<ApiInputs["engineMode"], ContractInputs["engineMode"]>
>;
type EngineModeOutputConforms = Expect<
  Equal<ApiOutputs["engineMode"], ContractOutputs["engineMode"]>
>;
type GetByIdInputConforms = Expect<
  Equal<ApiInputs["getById"], ContractInputs["getById"]>
>;
type GetByIdOutputConforms = Expect<
  Equal<ApiOutputs["getById"], ContractOutputs["getById"]>
>;
type GetVersionsInputConforms = Expect<
  Equal<ApiInputs["getVersions"], ContractInputs["getVersions"]>
>;
type GetVersionsOutputConforms = Expect<
  Equal<ApiOutputs["getVersions"], ContractOutputs["getVersions"]>
>;

export type WorkflowApiContractConformance =
  | EngineModeInputConforms
  | EngineModeOutputConforms
  | GetByIdInputConforms
  | GetByIdOutputConforms
  | GetVersionsInputConforms
  | GetVersionsOutputConforms;
