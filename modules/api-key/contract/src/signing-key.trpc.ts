/**
 * Every `signingKeys.*` procedure, declared once (ADR-183 §4). Only `create` and `rotate`
 * answer a secret, once; `list` never does.
 */
import { defineTrpcContract } from "@langwatch/module";

import {
  createSigningKeyInputSchema,
  issuedSigningKeySchema,
  signingKeyActionInputSchema,
  signingKeyProjectInputSchema,
  signingKeySchema,
} from "./signing-key.ts";

export const signingKeyTrpc = defineTrpcContract("signingKeys")
  .query("list")
  .withInput(signingKeyProjectInputSchema)
  .withOutput(signingKeySchema.array())

  .mutation("create")
  .withInput(createSigningKeyInputSchema)
  .withOutput(issuedSigningKeySchema)

  .mutation("rotate")
  .withInput(signingKeyActionInputSchema)
  .withOutput(issuedSigningKeySchema)

  .mutation("revoke")
  .withInput(signingKeyActionInputSchema)
  .withOutput(signingKeySchema)

  .build();
