import { z } from "zod";

import type { GatewayVirtualKeyRepository } from "../../../repositories/gateway-virtual-key.repository.ts";

/** What the step has done so far; the ledger keeps it. A count and a key id, never a person. */
export const virtualKeyPersonalMarkReportSchema = z.object({
  afterId: z.string().nullable(),
  marked: z.number(),
});
export type VirtualKeyPersonalMarkReport = z.infer<typeof virtualKeyPersonalMarkReportSchema>;

type PersonalMarkStore = Pick<
  GatewayVirtualKeyRepository,
  "findUnmarkedPersonalIds" | "markMintedAsPersonal"
>;

/** Keys a page holds: small enough that a pass saves progress often. */
const PAGE_SIZE = 500;

/**
 * Marks every key minted with a principal before `mintedAsPersonal` existed, so it stays
 * personal once erasure clears the principal (gateway-budget-service.feature). Level-triggered:
 * a marked key is never listed again, so a second pass marks nothing.
 */
export class VirtualKeyPersonalMarkService {
  static create({
    virtualKeys,
  }: {
    virtualKeys: PersonalMarkStore;
  }): VirtualKeyPersonalMarkService {
    return new VirtualKeyPersonalMarkService(virtualKeys);
  }

  private constructor(private readonly virtualKeys: PersonalMarkStore) {}

  async markPersonalKeys({
    dryRun,
    signal,
    resumeFrom,
    onPageDone,
  }: {
    dryRun: boolean;
    signal: AbortSignal;
    resumeFrom: VirtualKeyPersonalMarkReport | null;
    onPageDone: (report: VirtualKeyPersonalMarkReport) => Promise<void>;
  }): Promise<VirtualKeyPersonalMarkReport> {
    const report: VirtualKeyPersonalMarkReport = {
      afterId: resumeFrom?.afterId ?? null,
      marked: resumeFrom?.marked ?? 0,
    };
    while (!signal.aborted) {
      const ids = await this.virtualKeys.findUnmarkedPersonalIds({
        afterId: report.afterId,
        limit: PAGE_SIZE,
      });
      const last = ids.at(-1);
      if (last === undefined) break;
      report.marked += dryRun ? ids.length : await this.virtualKeys.markMintedAsPersonal({ ids });
      report.afterId = last;
      if (!dryRun) await onPageDone({ ...report });
    }

    return report;
  }
}
