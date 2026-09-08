// The browser-safe half of the API framework: what a feature declares, with
// no server, no tRPC runtime and no Node API in its value-import graph. A
// contract module imports this and its own schemas, and nothing else.

export {
  defineTrpcContract,
  type TrpcContract,
  type TrpcContractBuilder,
  type TrpcContractInputBuilder,
  type TrpcContractKind,
  type TrpcContractMember,
  type TrpcContractMembers,
  type TrpcContractOutputBuilder,
} from "./trpc-contract.ts";
