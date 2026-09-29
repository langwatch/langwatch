// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { moduleApi } from "@langwatch/kernel/module-api";

import type { NurturingSignal } from "./nurturing-signals.ts";

/** Every owner tells nurturing through a subscriber on its own pipeline (§9); nurturing names no peer. */
export interface NurturingApi {
  /** Records the signal on nurturing's pipeline; its subscriber sends what main sent, once. */
  recordSignal(signal: NurturingSignal): Promise<void>;
}

export const NurturingApi = moduleApi<NurturingApi>()("nurturing");
