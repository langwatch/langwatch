// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { LangWatchCloudOnlyError } from "@langwatch/enterprise-saas-contract";

/**
 * The one place that decides this deployment is LangWatch Cloud. Today that is
 * the process's `isSaas` fact; a signed licence replaces it here, and only here.
 * @see ../../../adrs/002-saas-is-the-cloud-module.md
 */
export class LangWatchCloudService {
  readonly #isCloud: boolean;

  private constructor(isCloud: boolean) {
    this.#isCloud = isCloud;
  }

  static create({ isSaas }: { isSaas: boolean }): LangWatchCloudService {
    return new LangWatchCloudService(isSaas);
  }

  /** Refuses, by code, anything asked of a deployment that is not Cloud. */
  assertCloud(): void {
    if (!this.#isCloud) throw new LangWatchCloudOnlyError();
  }
}
