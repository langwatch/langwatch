// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { OpsApi, OpsOperator } from "@langwatch/ops-contract";

type Deps = Readonly<{ ops: Pick<OpsApi, "admitCloudAdmin" | "admitOperator"> }>;

/** Who may change the digest's switches or send a test: Cloud admin staff with `ops:manage`. */
export class DigestOperatorsService {
  static create(deps: Deps): DigestOperatorsService {
    return new DigestOperatorsService(deps);
  }

  private constructor(private readonly deps: Deps) {}

  /** The admitted staff member's id; anyone else learns nothing of the surface (§3.5). */
  async admitManager(operator: OpsOperator | null): Promise<string> {
    const staff = await this.deps.ops.admitCloudAdmin(operator);
    await this.deps.ops.admitOperator(operator, "ops:manage");
    return staff.id;
  }
}
