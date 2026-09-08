import { defineFeature } from "@langwatch/runtime-composition";
import { NullAuditLog } from "./null-audit-log.app.ts";

export const auditLogNullServer = defineFeature("audit-log").withApp(NullAuditLog).build();
