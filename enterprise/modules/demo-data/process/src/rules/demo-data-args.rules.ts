// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { DemoDataRunInput } from "@langwatch/enterprise-demo-data-contract";

/** Main's CLI flags: `--execute` and `--org-id <id>`; anything else is refused by name. */
export function parseDemoDataArgs(args: readonly string[]): DemoDataRunInput {
  let execute = false;
  let organizationId: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--execute") {
      execute = true;
    } else if (arg === "--org-id") {
      organizationId = args[++i];
      if (organizationId === undefined) throw new Error("--org-id requires a value");
    } else if (arg !== undefined) {
      throw new Error(`unknown argument ${JSON.stringify(arg)}`);
    }
  }
  return organizationId === undefined ? { execute } : { execute, organizationId };
}
