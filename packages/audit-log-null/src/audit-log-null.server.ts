import { defineServerModule } from "@langwatch/kernel";

import { NullAuditLog } from "./null-audit-log.app.ts";

export const auditLogNullServer = defineServerModule("audit-log").withApp(NullAuditLog).build();
