import { defineServerModule } from "@langwatch/kernel";

import type { DataPrivacyDirectoryReader } from "./app/data-privacy.app.ts";
import { DataPrivacyApp } from "./app/data-privacy.app.ts";
import { dataPrivacyRepositories } from "./repositories/data-privacy-repositories.registry.ts";
import {
  PrismaDataPrivacyDirectoryRepository,
  type DataPrivacyDirectoryDatabase,
} from "./repositories/prisma/prisma.data-privacy-directory.repository.ts";
import {
  OtlpSpanContentDropService,
  type OtlpSpanContentDropServiceOptions,
} from "./services/otlp-span-content-drop.service.ts";
import { OtlpSpanPiiRedactionService } from "./services/otlp-span-pii-redaction.service.ts";
import type { OtlpSpanPiiRedactionServiceDependencies } from "./services/pii-redaction-policy.service.ts";
import { dataPrivacyTrpcTransport } from "./transport/data-privacy.trpc.ts";

export const dataPrivacyServer = defineServerModule("data-privacy")
  .withRepositories(dataPrivacyRepositories)
  .withApp(DataPrivacyApp)
  .withTransports(dataPrivacyTrpcTransport);

/**
 * Runtime seams: thin factories over this feature's private classes, so a
 * composition root never names one directly (private-runtime-export drive,
 * dev/docs/plans/private-runtime-export-drive.md §3d).
 */

export function createDataPrivacyDirectoryReader(
  database: DataPrivacyDirectoryDatabase,
): DataPrivacyDirectoryReader {
  return PrismaDataPrivacyDirectoryRepository.create(database);
}

export function createOtlpSpanContentDropService(
  options: OtlpSpanContentDropServiceOptions,
): OtlpSpanContentDropService {
  return OtlpSpanContentDropService.create(options);
}

export function createOtlpSpanPiiRedactionService(
  deps: OtlpSpanPiiRedactionServiceDependencies,
): OtlpSpanPiiRedactionService {
  return OtlpSpanPiiRedactionService.create(deps);
}
