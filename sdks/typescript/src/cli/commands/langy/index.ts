/**
 * `langwatch langy --share-control`: share this folder with the Langy
 * conversation that asked for it.
 *
 * The command is a live session, not a query. It signs in, finds the control
 * request the conversation recorded, asks in the terminal, and then executes
 * the calls Langy makes with its local tools until Ctrl-C or a disconnect
 * from the panel.
 *
 * @see specs/typescript-sdk/cli-langy-share-control.feature
 * @see dev/docs/adr/129-langy-local-control.md
 */

import chalk from "chalk";
import { loginCommand } from "../login";
import {
  chooseRequest,
  createControlApi,
  describeWorkspace,
  ensureSignedIn,
  isGitRepository,
  resolveShareRoot,
  ShareControlError,
  waitForRequests,
} from "./requests";
import { startLangySession } from "./session";

export interface LangyCommandOptions {
  /** The one thing the command does today. A bare `langwatch langy` does it too. */
  shareControl?: boolean;
  /** Declared only so the refusal can say why, see `refuseStructuredOutput`. */
  output?: string;
}

/**
 * The reason `-o json` is refused. The command is a session that prints as it
 * goes and ends when the user stops it, so there is no document to render.
 */
export const INTERACTIVE_ONLY_MESSAGE =
  "`langy` is an interactive session, not a query, so it has no structured output. Run it without -o/--output.";

/** The refusal for a structured-output request, or null when none was made. */
export function refuseStructuredOutput(
  options: LangyCommandOptions,
): string | null {
  return options.output === undefined ? null : INTERACTIVE_ONLY_MESSAGE;
}

export async function langyCommand(
  options: LangyCommandOptions = {},
): Promise<void> {
  const refusal = refuseStructuredOutput(options);
  if (refusal) {
    console.error(chalk.red(refusal));
    process.exitCode = 1;
    return;
  }

  let root: string;
  try {
    root = resolveShareRoot();
  } catch (error) {
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exitCode = 1;
    return;
  }

  try {
    await shareControl(root);
  } catch (error) {
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exitCode = 1;
  }
}

async function shareControl(root: string): Promise<void> {
  const credentials = await ensureSignedIn({
    login: async ({ device }) => {
      await loginCommand({ device });
    },
  });
  const api = createControlApi(credentials);

  const requests = await waitForRequests({
    api,
    onWaiting: () => {
      console.log("");
      console.log(
        `Waiting for a Langy conversation to ask for this folder (${root}).`,
      );
      console.log(
        chalk.gray(
          "Ask Langy for a code change in the LangWatch panel; its request appears here.",
        ),
      );
    },
  });

  const choice = await chooseRequest({ requests, root });
  if (choice.action === "quit") return;
  if (choice.action === "cancel") {
    await api.cancel({ requestId: choice.request.id });
    console.log("Cancelled. The conversation has been told.");
    return;
  }

  const workspace = describeWorkspace(root);
  const approved = await api.approve({
    requestId: choice.request.id,
    workspace,
  });
  if (!approved?.sessionKey) {
    throw new ShareControlError(
      "LangWatch approved the request but sent no session key. Try the command again.",
    );
  }

  const session = startLangySession({
    endpoint: approved.endpoint || credentials.endpoint,
    sessionKey: approved.sessionKey,
    workspace,
    conversation: approved.conversation ?? {
      id: choice.request.conversationId,
      title: choice.request.conversationTitle,
      url: choice.request.conversationUrl,
    },
    withoutGit: !isGitRepository(root),
  });

  const onSignal = () => session.requestShutdown();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  const code = await session.done;
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  process.exitCode = code;
}
