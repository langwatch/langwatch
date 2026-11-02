// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ObjectStorage } from "@langwatch/process-stores";
import type { Instant } from "@langwatch/time";

import {
  UPGRADE_DIAGNOSTICS_TENANT,
  upgradeDiagnosticsObjectKey,
} from "../../rules/upgrade-diagnostics.rules.ts";
import { UpgradeDiagnosticBundleRepository } from "../upgrade-diagnostic-bundle.repository.ts";

/** Bundles on the platform tenant's shared backend, under `upgrade-diagnostics/`. */
export class ObjectStorageUpgradeDiagnosticBundleRepository extends UpgradeDiagnosticBundleRepository {
  static create(objectStorage: ObjectStorage): ObjectStorageUpgradeDiagnosticBundleRepository {
    return new ObjectStorageUpgradeDiagnosticBundleRepository(objectStorage);
  }

  private constructor(private readonly objects: ObjectStorage) {
    super();
  }

  async write({
    instanceId,
    reportId,
    body,
  }: {
    instanceId: string;
    reportId: string;
    body: Uint8Array;
  }): Promise<{ objectKey: string }> {
    const objectKey = upgradeDiagnosticsObjectKey({ instanceId, reportId });
    await this.objects.write(
      { projectId: UPGRADE_DIAGNOSTICS_TENANT, key: objectKey },
      once(body),
      {
        byteLength: body.byteLength,
        contentType: "application/json",
      },
    );
    return { objectKey };
  }

  signDownload({
    objectKey,
    expiresAt,
  }: {
    objectKey: string;
    expiresAt: Instant;
  }): Promise<string> {
    return this.objects.signDownload(
      { projectId: UPGRADE_DIAGNOSTICS_TENANT, key: objectKey },
      { expiresAt },
    );
  }
}

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}
