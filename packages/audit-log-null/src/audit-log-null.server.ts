import { defineProcessModule } from "@langwatch/process";

import { NullAuditLog } from "./null-audit-log.app.ts";

export const auditLogNullProcessModule = defineProcessModule("audit-log").withApi(NullAuditLog).build();
