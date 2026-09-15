/**
 * The single public surface for anonymous shared-trace reads (ADR-057). One
 * token-validated call returns everything the share page needs as an
 * explicit share-safe DTO. Kept as its own namespace, not a procedure on
 * `tracesV2`, since it's the one place a request with no session gets a
 * trace.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { sharedTraceDtoSchema } from "./trace-share.schemas.ts";

export const sharedTraceTrpc = defineTrpcContract("sharedTrace")
  .query("get")
  .withInput(z.object({ token: z.string() }))
  .withOutput(sharedTraceDtoSchema)
  .build();
