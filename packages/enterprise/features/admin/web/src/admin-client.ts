/**
 * Thin typed wrapper around the Hono `/api/admin/:resource` endpoints.
 *
 * The backend (see `ee/admin/routes/admin.ts`) is a `ra-data-simple-prisma`
 * handler: every call is a POST with `{ resource, method, params }`. The
 * Chakra backoffice UI talks to it through this wrapper, keeping all business
 * logic (user deactivate/reactivate side effects, org ssoDomain normalization,
 * subscription list join, search logic, audit logs) in one place on the server.
 */

import type { AdminResourceName } from "@langwatch/enterprise-admin-contract";

export type ResourceName = AdminResourceName;

export type SortOrder = "ASC" | "DESC";

export interface ListParams {
  pagination?: { page: number; perPage: number };
  sort?: { field: string; order: SortOrder };
  filter?: Record<string, unknown>;
}

export interface ListResult<T> {
  data: T[];
  total: number;
}

export interface DataResult<T> {
  data: T;
}

/**
 * A failed `/api/admin/*` call, carrying whatever the server said.
 *
 * The admin endpoints are Hono routes, so a handled failure comes back in the
 * flat REST shape — `{ error: "<code>", message, ...meta, tips, docsUrl,
 * fault, trace }` (see `src/app/api/middleware/error-handler.ts`). Copying
 * those fields onto the thrown error is what lets `readHandledError` lift
 * them: it reads that shape off the error object itself.
 *
 * Before this, the backoffice threw `new Error("Admin user/update failed
 * (403): {...}")`. Nothing could read a code off that, so every one of these
 * failures rendered as "Something went wrong — we've been notified", with the
 * actual reason sitting unread inside the message and no error id to quote.
 */
class AdminRequestError extends Error {
  constructor(message: string, body: object, status: number) {
    super(message);
    this.name = "AdminRequestError";
    // `status` so the reader can report an httpStatus; the body's own
    // envelope keys are the handled payload. Assigning `message` again from
    // the body is a no-op — it is already this error's message.
    Object.assign(this, body, { status });
  }
}

/**
 * Reads the failure body and throws it in a shape the error UI understands.
 *
 * `context` is the fallback sentence for a response with nothing to say — an
 * HTML error page from a proxy, an empty 502. It never overrides the server's
 * own message, because that one is about the actual failure.
 */
async function throwAdminError(res: Response, context: string): Promise<never> {
  const raw = await res.text().catch(() => "");
  let body: object = {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed;
    }
  } catch {
    // Not JSON — nothing structured to lift, so the error stays unhandled and
    // degrades to the generic treatment. Correct, per ADR-045.
  }

  const serverMessage = (body as { message?: unknown }).message;
  throw new AdminRequestError(
    typeof serverMessage === "string" && serverMessage.length > 0
      ? serverMessage
      : `${context} (${res.status})`,
    body,
    res.status,
  );
}

export interface AdminClientOptions {
  fetch?: typeof globalThis.fetch | undefined;
  basePath?: string | undefined;
}

export class AdminClient {
  private constructor(
    private readonly fetcher: typeof globalThis.fetch,
    private readonly basePath: string,
  ) {}

  static create(options: AdminClientOptions = {}): AdminClient {
    return new AdminClient(
      options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
      options.basePath ?? "/api/admin",
    );
  }

  private async adminFetch<T>(
    resource: ResourceName,
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    const res = await this.fetcher(`${this.basePath}/${resource}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource, method, params }),
      credentials: "include",
    });

    if (!res.ok) {
      await throwAdminError(res, `Admin ${resource}/${method} failed`);
    }

    return (await res.json()) as T;
  }

  getList<T>(
    resource: ResourceName,
    params: ListParams,
  ): Promise<ListResult<T>> {
    const {
      pagination = { page: 1, perPage: 25 },
      sort = { field: "id", order: "ASC" as const },
      filter = {},
    } = params;
    return this.adminFetch<ListResult<T>>(resource, "getList", {
      pagination,
      sort,
      filter,
    });
  }

  getOne<T>(resource: ResourceName, id: string): Promise<DataResult<T>> {
    return this.adminFetch<DataResult<T>>(resource, "getOne", { id });
  }

  update<T>(
    resource: ResourceName,
    id: string,
    data: Record<string, unknown>,
  ): Promise<DataResult<T>> {
    return this.adminFetch<DataResult<T>>(resource, "update", { id, data });
  }

  create<T>(
    resource: ResourceName,
    data: Record<string, unknown>,
  ): Promise<DataResult<T>> {
    return this.adminFetch<DataResult<T>>(resource, "create", { data });
  }

  async impersonateUser(input: {
    userIdToImpersonate: string;
    reason: string;
  }): Promise<void> {
    const res = await this.fetcher(`${this.basePath}/impersonate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      credentials: "include",
    });
    if (!res.ok) await throwAdminError(res, "Impersonation failed");
  }
}

export const adminClient = AdminClient.create();

/**
 * Impersonation is a separate endpoint (`/api/admin/impersonate`) that takes
 * a non-resource body. Exposed here so the Users table can reuse it without
 * duplicating fetch plumbing.
 */
export async function impersonateUser({
  userIdToImpersonate,
  reason,
}: {
  userIdToImpersonate: string;
  reason: string;
}): Promise<void> {
  return adminClient.impersonateUser({ userIdToImpersonate, reason });
}
