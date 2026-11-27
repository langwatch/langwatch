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

interface OrganizationPage {
  items: Row[];
  total: number;
  truncated: boolean;
  nextCursor: string | null;
}

/** `langwatch ops orgs [--query <q>]`: a page of organizations across the platform (ops:read). */
export const opsOrgsCommand = async ({
  query,
  limit,
  cursor,
}: {
  query?: string;
  limit?: string;
  cursor?: string;
}): Promise<CommandResult> => {
  const { opsToken, endpoint } = requireOpsToken();
  const params = new URLSearchParams();
  if (query?.trim()) params.set("query", query.trim());
  if (limit) params.set("limit", limit);
  if (cursor) params.set("cursor", cursor);
  const search = params.size > 0 ? `?${params.toString()}` : "";
  const page = await staffAccessFetch<OrganizationPage>({
    method: "GET",
    path: `/api/staff-access/ops/organizations${search}`,
    bearer: opsToken,
    endpoint,
  });
  const organizations = page.items ?? [];
  return {
    data: page,
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
      console.log(
        chalk.gray(
          `Showing ${organizations.length} of ${page.total}${page.truncated ? `. More: --cursor ${page.nextCursor}` : "."}`,
        ),
      );
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
