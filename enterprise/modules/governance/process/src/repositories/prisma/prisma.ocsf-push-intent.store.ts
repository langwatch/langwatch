// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ProcessStore } from "@langwatch/eventing";
import { PrismaProcessStore } from "@langwatch/eventing/server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

/**
 * Governance's OCSF push intents over its own Postgres, for a process that runs no pipeline (the
 * api): the worker drains them with the same handler as its own. Opened on first use.
 * Spec: enterprise/modules/governance/specs/ocsf-siem.feature
 */
export class PrismaOcsfPushIntentStore implements Pick<ProcessStore, "appendIntents"> {
  static create(database: PrismaClient): PrismaOcsfPushIntentStore {
    return new PrismaOcsfPushIntentStore(database);
  }

  #store: PrismaProcessStore | undefined;

  private constructor(private readonly database: PrismaClient) {}

  appendIntents(
    params: Parameters<ProcessStore["appendIntents"]>[0],
  ): ReturnType<ProcessStore["appendIntents"]> {
    this.#store ??= PrismaProcessStore.create({ database: this.database });
    return this.#store.appendIntents(params);
  }
}
