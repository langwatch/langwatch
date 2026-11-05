// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The notices LangWatch staff send self-hosted installs: written as a draft, published with the
 * staff member recorded, withdrawn when no longer true. Only a published notice that has not
 * expired is sent, in Cloud's reply to an install's daily usage report.
 * @see ../../../specs/self-hosted-notices.feature
 */
import type {
  CreateSelfHostedNoticeInput,
  SelfHostedNoticeView,
  UpdateSelfHostedNoticeInput,
} from "@langwatch/enterprise-licensing-contract";
import { generate } from "@langwatch/ksuid";
import type { SelfHostedNotice } from "@langwatch/ops-contract";
import { Temporal, type Instant } from "@langwatch/time";

import type {
  SelfHostedNoticeRecord,
  SelfHostedNoticeRepository,
} from "../repositories/self-hosted-notice.repository.ts";
import { selfHostedNoticeView, selfHostedNoticeWire } from "../rules/self-hosted-notice.rules.ts";

const SELF_HOSTED_NOTICE_KSUID_RESOURCE = "shnotice";

export class SelfHostedNoticeService {
  static create(options: {
    repository: SelfHostedNoticeRepository;
    now: () => Instant;
  }): SelfHostedNoticeService {
    return new SelfHostedNoticeService(options.repository, options.now);
  }

  private constructor(
    private readonly repository: SelfHostedNoticeRepository,
    private readonly now: () => Instant,
  ) {}

  /** Every notice, drafts and withdrawn ones included, the newest written first. */
  async findAll(): Promise<SelfHostedNoticeView[]> {
    return (await this.repository.findAll()).map(selfHostedNoticeView);
  }

  /** Keeps a new notice as a draft; nothing is sent until it is published. */
  async create(input: CreateSelfHostedNoticeInput): Promise<SelfHostedNoticeView> {
    const now = this.now();
    const row: SelfHostedNoticeRecord = {
      id: generate(SELF_HOSTED_NOTICE_KSUID_RESOURCE).toString(),
      ...fieldsOf(input),
      status: "draft",
      publishedAt: null,
      publishedBy: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.insert(row);
    return selfHostedNoticeView(row);
  }

  /** Rewrites what a notice says; a published one is sent as edited from the next report. */
  async update(input: UpdateSelfHostedNoticeInput): Promise<SelfHostedNoticeView> {
    const current = await this.repository.getById(input.id);
    return this.write({ ...current, ...fieldsOf(input) });
  }

  /** Sends a notice from the next report on; publishing one already published changes nothing. */
  async publish(input: { id: string; operatorId: string }): Promise<SelfHostedNoticeView> {
    const current = await this.repository.getById(input.id);
    if (current.status === "published") return selfHostedNoticeView(current);
    return this.write({
      ...current,
      status: "published",
      publishedAt: this.now(),
      publishedBy: input.operatorId,
    });
  }

  /** Stops sending a notice; who published it and when stay on the row. */
  async withdraw(input: { id: string }): Promise<SelfHostedNoticeView> {
    const current = await this.repository.getById(input.id);
    if (current.status === "withdrawn") return selfHostedNoticeView(current);
    return this.write({ ...current, status: "withdrawn" });
  }

  /** What an install is sent now: published, not expired, the newest published first. */
  async findSent(): Promise<SelfHostedNotice[]> {
    const rows = await this.repository.findAllSentAt(this.now());
    return rows.flatMap(selfHostedNoticeWire);
  }

  private async write(row: SelfHostedNoticeRecord): Promise<SelfHostedNoticeView> {
    const written = { ...row, updatedAt: this.now() };
    await this.repository.replace(written);
    return selfHostedNoticeView(written);
  }
}

function fieldsOf(input: CreateSelfHostedNoticeInput) {
  return {
    severity: input.severity,
    title: input.title,
    body: input.body,
    url: input.url,
    fixedIn: input.fixedIn,
    expiresAt: input.expiresAt === null ? null : Temporal.Instant.from(input.expiresAt),
  };
}
