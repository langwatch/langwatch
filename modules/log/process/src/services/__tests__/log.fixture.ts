import type { LogRedaction } from "../canonical-log.service.ts";
import { CanonicalLogService } from "../canonical-log.service.ts";
import { LogService } from "../log.service.ts";

/** The log service over the real preparation adapter, for tests that drive it. */
export function createLogTestService(options: { redaction: LogRedaction }): LogService {
  return LogService.create({
    preparation: CanonicalLogService.create({ redaction: options.redaction }),
  });
}
