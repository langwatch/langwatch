import { defineModule } from "@langwatch/runtime-composition";
import { NullAuditLog } from "./null-audit-log.app.ts";

export const auditLogNullServer = defineModule("audit-log").withApp(NullAuditLog).build();
