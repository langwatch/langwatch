/** Every `notification.*` procedure. */

import { defineTrpcContract } from "@langwatch/kernel/contract";

import { readHintSchema, readHintsInputSchema } from "./read-hints.ts";

export const notificationTrpc = defineTrpcContract("notification")
  /** The focused tab's one hint stream: its user's, organization's and project's read hints. */
  .subscription("onReadHints")
  .withInput(readHintsInputSchema)
  .withOutput(readHintSchema)
  .build();
