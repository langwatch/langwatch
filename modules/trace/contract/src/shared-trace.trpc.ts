/** The one public trace read (ADR-057): the share token in the input is the whole authorization. */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { sharedTraceDtoSchema } from "./trace-share.schemas.ts";

export const sharedTraceGetInputSchema = z.object({ token: z.string() });

export const sharedTraceTrpc = defineTrpcContract("sharedTrace")
  .query("get")
  .withInput(sharedTraceGetInputSchema)
  .withOutput(sharedTraceDtoSchema)
  .build();
