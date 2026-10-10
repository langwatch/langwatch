import type { z } from "zod";

import {
  actionAnswerSchema,
  cliReadSchema,
  notFoundSchema,
  revealedKeySchema,
  stackHomeSchema,
  type NotFound,
  type StackHome,
} from "./contract.ts";

/** A read the daemon did not answer within this long counts as a failed poll. */
const READ_TIMEOUT_MS = 5000;

const read = async ({ path, signal }: { path: string; signal?: AbortSignal }) => {
  const timeout = AbortSignal.timeout(READ_TIMEOUT_MS);
  return fetch(path, {
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
};

const failure = async ({ response, path }: { response: Response; path: string }) => {
  const text = (await response.text().catch(() => "")).trim();
  return new Error(text.length > 0 ? text : `${path} answered ${response.status}`);
};

export const getJson = async <T>({
  path,
  schema,
  signal,
}: {
  path: string;
  schema: z.ZodType<T>;
  signal?: AbortSignal;
}): Promise<T> => {
  const response = await read({ path, signal });
  if (!response.ok) throw await failure({ response, path });
  return schema.parse(await response.json());
};

export type StackHomeAnswer =
  | { found: true; home: StackHome }
  | { found: false; notFound: NotFound };

export const getStackHome = async ({
  slug,
  signal,
}: {
  slug: string;
  signal?: AbortSignal;
}): Promise<StackHomeAnswer> => {
  const path = `/api/stacks/${encodeURIComponent(slug)}`;
  const response = await read({ path, signal });
  if (response.status === 404) {
    return { found: false, notFound: notFoundSchema.parse(await response.json()) };
  }
  if (!response.ok) throw await failure({ response, path });
  return { found: true, home: stackHomeSchema.parse(await response.json()) };
};

const post = async ({
  path,
  body,
  method = "POST",
}: {
  path: string;
  body?: unknown;
  method?: "POST" | "PUT" | "DELETE";
}) =>
  fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** A lifecycle action (restart, start): answers the daemon's message or throws its error. */
export const postAction = async ({
  path,
  body,
  method,
}: {
  path: string;
  body?: unknown;
  method?: "POST" | "PUT" | "DELETE";
}): Promise<string> => {
  const response = await post({ path, body, method });
  const answer = actionAnswerSchema.safeParse(await response.json().catch(() => ({})));
  if (!answer.success) throw new Error(`${path} answered ${response.status}`);
  const { data } = answer;
  if ("error" in data) throw new Error(data.error);
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return data.message;
};

export const revealApiKey = async ({ path }: { path: string }): Promise<string> => {
  const response = await post({ path });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return revealedKeySchema.parse(await response.json()).apiKey;
};

export const restartPath = ({ slug }: { slug: string }) =>
  `/api/stacks/${encodeURIComponent(slug)}/restart`;

export const downPath = ({ slug }: { slug: string }) =>
  `/api/stacks/${encodeURIComponent(slug)}/down`;

export const destroyPath = ({ slug }: { slug: string }) =>
  `/api/stacks/${encodeURIComponent(slug)}/destroy`;

export const startServicePath = ({ slug, service }: { slug: string; service: string }) =>
  `/api/stacks/${encodeURIComponent(slug)}/start-service?service=${encodeURIComponent(service)}`;

export const resetDatabasesPath = ({ slug }: { slug: string }) =>
  `/api/stacks/${encodeURIComponent(slug)}/reset-databases`;

export const seedPath = ({ slug }: { slug: string }) =>
  `/api/stacks/${encodeURIComponent(slug)}/seed`;

export const LIMITS_PATH = "/api/limits";

export const limitPath = ({ name }: { name: string }) =>
  `${LIMITS_PATH}/${encodeURIComponent(name)}`;

export const START_PATH = "/api/worktrees/start";

/** One `haven <name> --json` read for a stack, as the daemon answers it. */
export const getCliRead = async <Rows>({
  slug,
  name,
  rows,
  signal,
}: {
  slug: string;
  name: string;
  rows: z.ZodType<Rows>;
  signal?: AbortSignal;
}): Promise<Rows> => {
  const answer = await getJson({
    path: `/api/stacks/${encodeURIComponent(slug)}/cli/${encodeURIComponent(name)}`,
    schema: cliReadSchema({ rows }),
    signal,
  });
  return answer.rows;
};

export const resolveFeedbackPath = ({ slug, id }: { slug: string; id: string }) =>
  `/api/stacks/${encodeURIComponent(slug)}/feedback/${encodeURIComponent(id)}/resolve`;

export const browserLanePath = ({
  slug,
  lane,
  view,
}: {
  slug: string;
  lane: string;
  view: "snapshot" | "screenshot";
}) => `/api/stacks/${encodeURIComponent(slug)}/browser/${encodeURIComponent(lane)}/${view}`;
