import chalk from "chalk";

import { formatTable, sanitizeTerminalText } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { printFacts } from "../management/_shared";
import { requireOpsToken, staffAccessFetch } from "./_shared";

type Row = Record<string, unknown>;

const text = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string") return sanitizeTerminalText(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return sanitizeTerminalText(JSON.stringify(value));
};

/** The listing whether the route answers an array or `{ organizations: [...] }`. */
const organizationsOf = (body: unknown): Row[] => {
  if (Array.isArray(body)) return body as Row[];
  const listed = (body as { organizations?: unknown } | null)?.organizations;
  return Array.isArray(listed) ? (listed as Row[]) : [];
};

/** `langwatch ops orgs [--query <q>]`: organizations across the platform (ops:read). */
export const opsOrgsCommand = async ({ query }: { query?: string }): Promise<CommandResult> => {
  const { opsToken, endpoint } = requireOpsToken();
  const search = query?.trim() ? `?query=${encodeURIComponent(query.trim())}` : "";
  const body = await staffAccessFetch<unknown>({
    method: "GET",
    path: `/api/staff-access/ops/organizations${search}`,
    bearer: opsToken,
    endpoint,
  });
  const organizations = organizationsOf(body);
  return {
    data: { organizations },
    table: () => {
      formatTable({
        data: organizations.map((org) => ({
          ID: text(org.id),
          Slug: text(org.slug),
          Name: text(org.name),
        })),
        headers: ["ID", "Slug", "Name"],
        colorMap: { Name: chalk.cyan },
        emptyMessage: "No organizations match.",
      });
    },
  };
};

/** Flattens nested usage into `a.b.c` facts so any usage shape reads as one list. */
const flatten = ({
  value,
  prefix = "",
}: {
  value: unknown;
  prefix?: string;
}): [string, string][] => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [[prefix || "value", text(value)]];
  }
  return Object.entries(value as Row).flatMap(([key, inner]) =>
    flatten({ value: inner, prefix: prefix ? `${prefix}.${key}` : key }),
  );
};

/** `langwatch ops usage <org>`: one organization's usage summary (ops:read). */
export const opsUsageCommand = async ({
  organization,
}: {
  organization: string;
}): Promise<CommandResult> => {
  const { opsToken, endpoint } = requireOpsToken();
  const body = await staffAccessFetch<unknown>({
    method: "GET",
    path: `/api/staff-access/ops/organizations/${encodeURIComponent(organization)}/usage`,
    bearer: opsToken,
    endpoint,
  });
  return {
    data: body,
    table: () => printFacts(flatten({ value: body })),
  };
};
