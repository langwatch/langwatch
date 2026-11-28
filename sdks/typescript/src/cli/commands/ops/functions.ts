import chalk from "chalk";

import { getEndpoint } from "../../utils/endpoint";
import { commandValidationError } from "../../utils/errorOutput";
import { formatTable, sanitizeTerminalText } from "../../utils/formatting";
import { loadRequesterKey, OPS_REQUESTER_KEY_ENV, readOpsSession } from "../../utils/opsSession";
import type { CommandResult } from "../../utils/output";
import { requireOpsToken, requireRequesterKey, staffAccessFetch } from "./_shared";

interface FunctionView {
  name: string;
  title: string;
  scope: string;
  answers: string;
  personal: boolean;
  inputSchema: Record<string, unknown>;
}

interface Page<Item> {
  items: Item[];
  total: number;
  truncated: boolean;
  nextCursor: string | null;
}

interface FunctionAnswer {
  name: string;
  rows: number;
  output: unknown;
}

const validationError = (message: string): Error =>
  Object.assign(new Error(message), commandValidationError(message));

/** The live session's ops token when there is one, else the requester key: both list. */
const listingBearer = (): { bearer: string; endpoint: string } => {
  const state = readOpsSession();
  if (state.kind === "live" && state.session.opsToken) {
    return { bearer: state.session.opsToken, endpoint: state.session.endpoint };
  }
  const requesterKey = loadRequesterKey() ?? process.env[OPS_REQUESTER_KEY_ENV]?.trim();
  return { bearer: requesterKey ?? requireRequesterKey(), endpoint: getEndpoint() };
};

/** `langwatch ops functions`: the functions the server offers, read from the server. */
export const opsFunctionsCommand = async (): Promise<CommandResult> => {
  const { bearer, endpoint } = listingBearer();
  const page = await staffAccessFetch<Page<FunctionView>>({
    method: "GET",
    path: "/api/staff-access/functions",
    bearer,
    endpoint,
  });
  return {
    data: page,
    table: () => {
      formatTable({
        data: page.items.map((fn) => ({
          Name: fn.name,
          Scope: fn.scope,
          Title: sanitizeTerminalText(fn.title),
        })),
        headers: ["Name", "Scope", "Title"],
        colorMap: { Name: chalk.cyan },
        emptyMessage: "No functions.",
      });
      console.log(
        chalk.gray(
          "Ask for them with: langwatch ops access request --function <name> ... ; -o json prints each input schema.",
        ),
      );
    },
  };
};

const parseInput = (raw: string | undefined): Record<string, unknown> => {
  if (raw === undefined || raw.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Refused below with the shape it needs.
  }
  throw validationError(
    '--input must be a JSON object, e.g. --input \'{"since":"2026-11-01T00:00:00Z"}\'',
  );
};

/** `langwatch ops call <name> --input <json>`: runs one approved function on the session. */
export const opsCallCommand = async ({
  name,
  input,
  cursor,
  limit,
}: {
  name: string;
  input?: string;
  cursor?: string;
  limit?: string;
}): Promise<CommandResult> => {
  const { opsToken, endpoint } = requireOpsToken();
  const parsedLimit = limit === undefined ? undefined : Number.parseInt(limit, 10);
  if (parsedLimit !== undefined && !Number.isFinite(parsedLimit)) {
    throw validationError("--limit must be a whole number.");
  }
  const body = {
    input: {
      ...parseInput(input),
      ...(cursor ? { cursor } : {}),
      ...(parsedLimit === undefined ? {} : { limit: parsedLimit }),
    },
  };
  const answer = await staffAccessFetch<FunctionAnswer>({
    method: "POST",
    path: `/api/staff-access/functions/${encodeURIComponent(name)}`,
    bearer: opsToken,
    body,
    endpoint,
  });
  return {
    data: answer,
    table: () => {
      const output = answer.output as Partial<Page<Record<string, unknown>>> | null;
      if (output && Array.isArray(output.items)) {
        console.log(JSON.stringify(output.items, null, 2));
        console.log(
          chalk.gray(
            `Showing ${output.items.length} of ${output.total ?? "?"}${output.truncated ? `. More: --cursor ${output.nextCursor}` : "."}`,
          ),
        );
        return;
      }
      console.log(JSON.stringify(answer.output, null, 2));
    },
  };
};
