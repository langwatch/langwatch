// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Notices LangWatch staff send self-hosted installs (self-hosted-notices.feature), as Cloud
 * admin writes, publishes and withdraws them. Licensing keeps them; saas sends them.
 */
import {
  createSelfHostedNoticeInputSchema,
  selfHostedNoticeIdInputSchema,
  selfHostedNoticeViewSchema,
  updateSelfHostedNoticeInputSchema,
} from "@langwatch/enterprise-licensing-contract";
import { defineTrpcContract } from "@langwatch/module";
import { z } from "zod";

export const selfHostedNoticesTrpc = defineTrpcContract("selfHostedNotices")
  .query("getAll")
  .withInput(z.void())
  .withOutput(z.array(selfHostedNoticeViewSchema))

  .mutation("create")
  .withInput(createSelfHostedNoticeInputSchema)
  .withOutput(selfHostedNoticeViewSchema)

  .mutation("update")
  .withInput(updateSelfHostedNoticeInputSchema)
  .withOutput(selfHostedNoticeViewSchema)

  .mutation("publish")
  .withInput(selfHostedNoticeIdInputSchema)
  .withOutput(selfHostedNoticeViewSchema)

  .mutation("withdraw")
  .withInput(selfHostedNoticeIdInputSchema)
  .withOutput(selfHostedNoticeViewSchema)
  .build();
