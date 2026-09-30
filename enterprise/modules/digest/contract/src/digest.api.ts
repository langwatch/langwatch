// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { moduleApi } from "@langwatch/kernel/module-api";
import type { OpsOperator } from "@langwatch/ops-contract";

import type {
  DigestCohortInput,
  DigestCohortRow,
  DigestMemberRow,
  DigestMetricRow,
  DigestPreview,
  DigestPreviewInput,
  DigestSendTestInput,
  DigestSetEnrolledInput,
  DigestSettings,
  DigestUnsubscribePage,
  DigestUpdate,
} from "./digest.ts";

type Operated = Readonly<{ operator: OpsOperator | null }>;

/**
 * Weekly digest emails. The Cloud-admin ops admit through `OpsApi.admitCloudAdmin` and answer
 * not_found where cloud ops is off (§3.5); the token ops are the public unsubscribe and click pair.
 */
export interface DigestApi {
  listCohort(input: DigestCohortInput & Operated): Promise<DigestCohortRow[]>;
  listMembers(input: { organizationId: string } & Operated): Promise<DigestMemberRow[]>;
  preview(input: DigestPreviewInput & Operated): Promise<DigestPreview>;
  setEnrolled(input: DigestSetEnrolledInput & Operated): Promise<void>;
  listUpdates(input: Operated): Promise<DigestUpdate[]>;
  saveUpdate(input: DigestUpdate & Operated): Promise<void>;
  getSettings(input: Operated): Promise<DigestSettings>;
  setArmed(input: { armed: boolean } & Operated): Promise<DigestSettings>;
  sendTest(input: DigestSendTestInput & Operated): Promise<void>;
  listMetrics(input: Operated): Promise<DigestMetricRow[]>;

  readUnsubscribe(input: { token: string }): Promise<DigestUnsubscribePage>;
  unsubscribe(input: { token: string }): Promise<void>;
  resubscribe(input: { token: string }): Promise<void>;
  /** Records the click and answers the stored address; the token never carries it. */
  followLink(input: { token: string }): Promise<string>;
}

export const DigestApi = moduleApi<DigestApi>()("digest");
