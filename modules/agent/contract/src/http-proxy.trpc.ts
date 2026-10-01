import { defineTrpcContract } from "@langwatch/kernel/contract";

import { httpAgentTestInputSchema } from "./agent.commands.ts";
import { httpProxyResultSchema } from "./agent.queries.ts";

export const httpProxyTrpc = defineTrpcContract("httpProxy")
  .mutation("execute")
  .withInput(httpAgentTestInputSchema)
  .withOutput(httpProxyResultSchema)
  .build();
