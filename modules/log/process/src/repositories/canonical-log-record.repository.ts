import { CanonicalLogRecordAppendRepository } from "./canonical-log-record-append.repository.ts";

/** The whole canonical-log surface a query graph composes: today, the append port alone. */
export abstract class CanonicalLogRecordRepository extends CanonicalLogRecordAppendRepository {}
