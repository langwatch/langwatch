import chalk from "chalk";

import type { Grant } from "@/client-sdk/services/grants/grants-api.service";

import { asDate, printFacts } from "../management/_shared";

export const principalOf = (grant: Grant): string =>
  `${grant.principal.type} ${grant.principal.name ?? grant.principal.id}`;

export const roleOf = (grant: Grant): string => grant.role.name ?? grant.role.id;

export const scopeOf = (grant: Grant): string =>
  `${grant.scope.type} ${grant.scope.name ?? grant.scope.id}`;

export const printGrant = (grant: Grant): void => {
  printFacts([
    ["ID", chalk.gray(grant.id)],
    ["Principal", chalk.cyan(principalOf(grant))],
    ["Role", `${roleOf(grant)}${grant.role.builtIn ? chalk.gray(" (built in)") : ""}`],
    ["Scope", scopeOf(grant)],
    ["Status", grant.status],
    ["Expires", grant.expiresAt ? asDate(grant.expiresAt) : "never"],
    ["Created", asDate(grant.createdAt)],
  ]);
};
