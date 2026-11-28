// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Audit log rows as OCSF 1.9.0 API Activity events. Spec: enterprise/modules/governance/specs/ocsf-siem.feature */
import type { AuditLogExportEntry } from "@langwatch/audit-log-contract";
import type { OcsfEvent } from "@langwatch/enterprise-governance-contract";

import { OTHER_ACTIVITY, toOcsfApiActivity } from "./ocsf-v1-9-event.rules.ts";

const DELETE_VERBS = new Set(["delete", "deleted", "remove", "removed", "archive", "revoke"]);
const CREATE_VERBS = new Set(["create", "created", "add", "added", "invite", "mint", "install"]);
const READ_VERBS = new Set(["view", "read", "list", "get", "export", "viewworkspaceas"]);
const UPDATE_VERBS = new Set(["update", "updated", "edit", "set", "rename", "change", "rotate"]);

/** The OCSF activity an audit action names by its last verb-like segment, else Other. */
function auditActivityId(action: string): number {
  const segments = action.toLowerCase().split(/[.:/_-]/);
  for (const segment of segments.toReversed()) {
    if (DELETE_VERBS.has(segment)) return 4;
    if (CREATE_VERBS.has(segment)) return 1;
    if (UPDATE_VERBS.has(segment)) return 3;
    if (READ_VERBS.has(segment)) return 2;
  }
  return OTHER_ACTIVITY;
}

/** One audit log row as an API Activity event; who acted is the real actor when one is named. */
export function auditEntryToOcsfEvent({
  entry,
  organizationId,
}: {
  entry: AuditLogExportEntry;
  organizationId: string;
}): OcsfEvent {
  const actor = entry.actorUserId ?? entry.userId ?? undefined;
  const failed = entry.error !== null && entry.error !== "";
  return toOcsfApiActivity({
    uid: `audit:${entry.id}`,
    timeMs: entry.createdAt.getTime(),
    activityId: auditActivityId(entry.action),
    severityId: failed ? 3 : 1,
    operation: entry.action,
    stream: "audit",
    organizationId,
    actor: { userUid: actor, subjectUserUid: entry.userId ?? undefined },
    failed,
    ...(failed ? { message: entry.error ?? undefined } : {}),
    ...(entry.targetId
      ? { resource: { uid: entry.targetId, type: entry.targetKind ?? undefined } }
      : {}),
    sourceEndpoint: {
      ip: entry.ipAddress ?? undefined,
      userAgent: entry.userAgent ?? undefined,
    },
    langwatch: { audit_log_id: entry.id, project_id: entry.projectId ?? undefined },
  });
}
