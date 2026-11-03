import chalk from "chalk";

import { OPS_REQUESTER_KEY_ENV, saveRequesterKey } from "../../utils/opsSession";
import type { CommandResult } from "../../utils/output";
import { opsAuthError } from "./_shared";

/** `langwatch ops setup`: stores the requester key in a 0600 file beside the CLI config. */
export const opsSetupCommand = ({ requesterKey }: { requesterKey?: string }): CommandResult => {
  const key = (requesterKey ?? process.env[OPS_REQUESTER_KEY_ENV])?.trim();
  if (!key) {
    throw opsAuthError(`Pass --requester-key <key> or set ${OPS_REQUESTER_KEY_ENV}.`);
  }
  if (!key.startsWith("lwsr_")) {
    throw opsAuthError("A requester key starts with lwsr_. Copy it from the Ops agents page.");
  }
  const file = saveRequesterKey({ requesterKey: key });
  return {
    data: { stored: true, file },
    table: () => {
      console.log(chalk.green(`Requester key stored in ${file} (mode 0600).`));
      console.log(
        chalk.gray('Next: langwatch ops access request --scope <scope> --reason "<why>"'),
      );
    },
  };
};
