import { CanonicalLogAdapter } from "../canonical-log.service.ts";
import type { LogRedaction } from "../../app/log.members.ts";
import type { CanonicalLogRecordRepository } from "../../repositories/canonical-log-record.repository.ts";
import { LogService } from "../log.service.ts";

/** The log service over the real preparation adapter, for tests that drive it. */
export function createLogTestService(options: {
  redaction: LogRedaction;
  repository: CanonicalLogRecordRepository;
}): LogService {
  return LogService.create({
    preparation: CanonicalLogAdapter.create({ redaction: options.redaction }),
    repository: options.repository,
  });
}
