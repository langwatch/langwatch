import * as readline from "node:readline";
import { Writable } from "node:stream";

import chalk from "chalk";

import { saveRequesterKey } from "../../utils/opsSession";
import type { CommandResult } from "../../utils/output";
import { opsAuthError } from "./_shared";

/** The setup command as the Ops agents page shows it: the key comes in on stdin. */
export const OPS_SETUP_COMMAND = "pbpaste | langwatch ops setup";

const readAll = async (input: NodeJS.ReadableStream): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
};

/** Asks for the key in a terminal without echoing it, so it stays out of scrollback. */
const promptHidden = ({
  input,
  prompt,
}: {
  input: NodeJS.ReadableStream;
  prompt: NodeJS.WritableStream;
}): Promise<string> =>
  new Promise((resolve) => {
    const muted = new Writable({ write: (_chunk, _encoding, done) => done() });
    const rl = readline.createInterface({ input, output: muted, terminal: true });
    prompt.write("Paste the requester key (input hidden): ");
    rl.question("", (answer) => {
      rl.close();
      prompt.write("\n");
      resolve(answer);
    });
  });

/**
 * `langwatch ops setup`: stores the requester key in a 0600 file beside the CLI config. The key is
 * read from stdin, never from an argument, so it stays out of shell history, `ps` and transcripts.
 */
export const opsSetupCommand = async ({
  input = process.stdin,
  prompt = process.stderr,
}: {
  input?: NodeJS.ReadableStream & { isTTY?: boolean };
  prompt?: NodeJS.WritableStream;
} = {}): Promise<CommandResult> => {
  const raw = input.isTTY ? await promptHidden({ input, prompt }) : await readAll(input);
  const key = raw.trim();
  if (!key) {
    throw opsAuthError(
      `No requester key on stdin. Copy it from the Ops agents page and run \`${OPS_SETUP_COMMAND}\`.`,
    );
  }
  if (!key.startsWith("lwsr_") || /\s/.test(key)) {
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
