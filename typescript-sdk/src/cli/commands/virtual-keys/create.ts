import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import {
  type VirtualKeyBudgetInput,
  type VirtualKeyRoutingMode,
  VirtualKeysApiService,
} from "@/client-sdk/services/virtual-keys/virtual-keys-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { formatScope, parseScopeArg, virtualKeyDetailUrl } from "./_shared";
import type { CommandResult } from "../../utils/output";

export interface CreateVirtualKeyOptions {
  name: string;
  description?: string;
  scope?: string[];
  routingPolicy?: string;
  routingMode?: string;
  principalUser?: string;
  budgetLimit?: string;
  budgetWindow?: string;
  budgetBreach?: "block" | "warn";
  providersAllowed?: string;
}

const ROUTING_MODES: VirtualKeyRoutingMode[] = ["NONE", "FALLBACK_ALL", "POLICY"];
const BUDGET_WINDOWS = ["DAY", "WEEK", "MONTH"] as const;

/**
 * Assemble the key's own cap from the three budget flags. The pair
 * limit+window travels together: one without the other is a half-said cap
 * the server would refuse anyway, so refuse it here with a usable message.
 */
function buildBudget(
  options: CreateVirtualKeyOptions,
): VirtualKeyBudgetInput | undefined {
  const anyBudgetFlag =
    options.budgetLimit !== undefined ||
    options.budgetWindow !== undefined ||
    options.budgetBreach !== undefined;
  if (!anyBudgetFlag) return undefined;
  if (!options.budgetLimit || !options.budgetWindow) {
    throw new Error(
      "--budget-limit and --budget-window travel together (e.g. --budget-limit 25 --budget-window month)",
    );
  }
  const window = options.budgetWindow.toUpperCase();
  if (!(BUDGET_WINDOWS as readonly string[]).includes(window)) {
    throw new Error("--budget-window must be one of day | week | month");
  }
  return {
    limit_usd: options.budgetLimit,
    window: window as (typeof BUDGET_WINDOWS)[number],
    on_breach: options.budgetBreach
      ? (options.budgetBreach.toUpperCase() as "BLOCK" | "WARN")
      : undefined,
  };
}

/**
 * Returns the created key rather than printing it: the output port renders it
 * in whatever format the caller asked for (utils/output.ts).
 *
 * `data` deliberately includes `secret`. This is the ONE moment the secret
 * exists — the server stores only its hash and never returns it again — so the
 * human output prints it in full, as did the previous `--format json` branch.
 * A `virtual-key create -o json` that withheld it would produce a key nobody
 * could ever use.
 */
export const createVirtualKeyCommand = async (
  options: CreateVirtualKeyOptions,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  if (!options.name) {
    console.error(chalk.red("Error: --name is required"));
    process.exit(1);
  }

  let scopes;
  let budget: VirtualKeyBudgetInput | undefined;
  let routingMode: VirtualKeyRoutingMode | undefined;
  try {
    // Omitted scopes are the common reseller path: the server scopes the
    // key to the calling project.
    scopes = options.scope?.length ? options.scope.map(parseScopeArg) : undefined;
    budget = buildBudget(options);
    if (options.routingMode !== undefined) {
      const mode = options.routingMode.toUpperCase();
      if (!(ROUTING_MODES as readonly string[]).includes(mode)) {
        throw new Error("--routing-mode must be one of none | fallback_all | policy");
      }
      routingMode = mode as VirtualKeyRoutingMode;
    }
  } catch (error) {
    console.error(chalk.red(`Error: ${(error as Error).message}`));
    process.exit(1);
  }

  const providersAllowed = options.providersAllowed
    ?.split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const service = new VirtualKeysApiService();
  const spinner = createSpinner(`Creating virtual key "${options.name}"...`).start();

  try {
    const { virtual_key, secret } = await service.create({
      name: options.name,
      description: options.description,
      principal_user_id: options.principalUser ?? null,
      scopes,
      routing_policy_id: options.routingPolicy ?? null,
      routing_mode: routingMode,
      budget,
      ...(providersAllowed?.length
        ? { config: { providersAllowed } }
        : {}),
    });

    spinner.succeed(`Created virtual key "${chalk.cyan(virtual_key.name)}"`);

    return {
      data: { virtual_key, secret },
      table: () => {
        console.log();
        console.log(chalk.bold.yellow("⚠  Save the secret below NOW. It will not be shown again."));
        console.log();
        console.log(`  ${chalk.green(secret)}`);
        console.log();
        console.log(chalk.gray("Use it as the API key in OpenAI-compatible clients:"));
        console.log(chalk.cyan("  export OPENAI_API_KEY=\"" + secret + "\""));
        console.log(chalk.cyan("  export OPENAI_BASE_URL=\"https://gateway.langwatch.ai/v1\""));
        console.log();
        console.log(chalk.gray("Virtual key id: ") + virtual_key.id);
        console.log(chalk.gray("Prefix:         ") + `${virtual_key.display_prefix}...`);
        console.log(chalk.gray("Scopes:         ") + virtual_key.scopes.map(formatScope).join(", "));
        console.log(chalk.gray("Routing mode:   ") + virtual_key.routing_mode);
        if (virtual_key.routing_policy_id) {
          console.log(chalk.gray("Routing policy: ") + virtual_key.routing_policy_id);
        }
        if (virtual_key.principal_user_id) {
          console.log(chalk.gray("Principal:      ") + virtual_key.principal_user_id);
        }
        if (budget) {
          console.log(
            chalk.gray("Budget:         ") +
              `$${budget.limit_usd} / ${String(budget.window).toLowerCase()} (${(budget.on_breach ?? "BLOCK").toLowerCase()})`,
          );
        }
        const detailUrl = virtualKeyDetailUrl(virtual_key.id);
        if (detailUrl) {
          console.log(chalk.gray("View in UI:     ") + chalk.cyan(detailUrl));
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "create virtual key" });
    process.exit(1);
  }
};
