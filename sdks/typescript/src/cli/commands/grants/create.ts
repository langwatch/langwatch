import chalk from "chalk";

import {
  GrantsApiService,
  type CreateGrantInput,
} from "@/client-sdk/services/grants/grants-api.service";

import { parseGrantPrincipalType, parseGrantScopeType } from "../../utils/managementFlags";
import type { CommandResult } from "../../utils/output";
import { runManagement, withParsedFlags } from "../management/_shared";
import { printGrant, principalOf } from "./_shared";

export interface CreateGrantOptions {
  principalType: string;
  principalId: string;
  role: string;
  scopeType: string;
  scopeId: string;
  expiresAt?: string;
  idempotencyKey?: string;
}

/**
 * Grant one role to one principal at one scope. The caller can only grant
 * permissions they hold themselves; an API key is checked as itself.
 */
export const createGrantCommand = async (
  options: CreateGrantOptions,
): Promise<CommandResult | void> => {
  const input = withParsedFlags((): CreateGrantInput => ({
    principal: {
      type: parseGrantPrincipalType(options.principalType),
      id: options.principalId,
    },
    roleId: options.role,
    scope: { type: parseGrantScopeType(options.scopeType), id: options.scopeId },
    ...(options.expiresAt !== undefined ? { expiresAt: options.expiresAt } : {}),
  }));

  return runManagement({
    action: "create grant",
    pending: "Creating grant...",
    run: () =>
      new GrantsApiService().create({
        input,
        ...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
      }),
    succeed: (grant) =>
      `Granted ${chalk.cyan(grant.role.name ?? grant.role.id)} to ${principalOf(grant)}`,
    table: printGrant,
  });
};
