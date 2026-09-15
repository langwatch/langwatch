import { defineServerModule } from "@langwatch/runtime-composition";
import { NullAuditLog } from "./null-audit-log.app.ts";

export const auditLogNullServer = defineServerModule("audit-log").withApp(NullAuditLog).build();
