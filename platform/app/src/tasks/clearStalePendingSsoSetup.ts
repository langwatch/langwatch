import { PrismaLegacySsoOrganizationRepository } from "@ee/sso/legacy-sso-organization.prisma.repository";
import {
  configuredSsoProviderStatus,
  extractEmailDomain,
  type OrganizationSsoProviderLookup,
} from "@ee/sso/matching";
import { createLogger } from "@langwatch/observability";

import { prisma } from "../server/db";

const logger = createLogger("langwatch:tasks:clearStalePendingSsoSetup");

const BATCH_SIZE = 200;

/**
 * One-off cleanup for `User.pendingSsoSetup`.
 *
 * The flag is set by the better-auth hook when an existing user links an
 * account that does not (yet) satisfy their organization's SSO pin, and is
 * otherwise only cleared by a LATER sign-in callback that happens to match
 * (see `getSsoStatus` in `../server/users/user.service.ts`, which this task
 * mirrors exactly: same domain extraction, same organization lookup, same
 * account mapping). A user who already holds a satisfying `Account` row but
 * has had no fresh sign-in since keeps a stale `true` until they next sign
 * in. This task re-asks the identical question in bulk and clears the flag
 * wherever it no longer reflects reality. A member whose flag is truthful is
 * left alone: their next single sign-on clears it. A member admitted only
 * through an organization's own connection is not re-checked here, the same
 * gap `getSsoStatus` names.
 *
 * Idempotent: a cleared user no longer matches the `pendingSsoSetup: true`
 * filter, so re-running the task converges to zero writes.
 *
 * Run it once per environment:
 *
 *   pnpm task clearStalePendingSsoSetup             # clear stale flags
 *   pnpm task clearStalePendingSsoSetup --dry-run    # count only, no writes
 */

interface CandidateUser {
  id: string;
  email: string | null;
  accounts: { provider: string; providerAccountId: string }[];
}

export interface CandidateUserPage {
  findPendingSsoSetupPage(args: {
    cursorId: string | null;
    take: number;
  }): Promise<CandidateUser[]>;
}

export interface PendingSsoSetupWriter {
  clearPendingSsoSetup(args: { id: string }): Promise<void>;
}

export interface ClearStalePendingSsoSetupResult {
  scanned: number;
  cleared: number;
  stillPending: number;
  skipped: number;
  failed: number;
  isDryRun: boolean;
}

/**
 * Wraps an organization lookup with a per-run, per-domain cache, so a batch
 * of users sharing a domain triggers one lookup rather than one per user.
 */
function cachedOrganizationLookup(
  organizations: OrganizationSsoProviderLookup,
): OrganizationSsoProviderLookup {
  const cache = new Map<
    string,
    ReturnType<OrganizationSsoProviderLookup["findByDomain"]>
  >();
  return {
    findByDomain({ domain }) {
      const cached = cache.get(domain);
      if (cached) return cached;
      const result = organizations.findByDomain({ domain });
      cache.set(domain, result);
      // A lookup that failed is asked again, so one transient error does not
      // fail every later user of that domain.
      result.catch(() => cache.delete(domain));
      return result;
    },
  };
}

type Outcome = "cleared" | "stillPending" | "skipped";

/**
 * Decides and, unless `isDryRun`, applies the outcome for a single user: skip
 * (no usable email domain), clear (an account already satisfies the pin, or
 * the organization no longer pins one), or leave as still pending (a pin
 * exists and no account satisfies it yet).
 */
async function resolveUser({
  user,
  writer,
  organizations,
  isDryRun,
}: {
  user: CandidateUser;
  writer: PendingSsoSetupWriter;
  organizations: OrganizationSsoProviderLookup;
  isDryRun: boolean;
}): Promise<Outcome> {
  const domain = extractEmailDomain(user.email);
  if (!domain) return "skipped";

  const status = await configuredSsoProviderStatus({
    organizations,
    domain,
    accounts: user.accounts.map((account) => ({
      providerId: account.provider,
      accountId: account.providerAccountId,
    })),
  });
  if (status === "unmatched") return "stillPending";

  if (!isDryRun) {
    await writer.clearPendingSsoSetup({ id: user.id });
  }
  return "cleared";
}

/**
 * Resolves every user in one page, mutating `result` in place. One user's
 * failure is caught and counted; it never aborts the rest of the page.
 */
async function resolvePage({
  page,
  writer,
  organizations,
  isDryRun,
  result,
}: {
  page: CandidateUser[];
  writer: PendingSsoSetupWriter;
  organizations: OrganizationSsoProviderLookup;
  isDryRun: boolean;
  result: ClearStalePendingSsoSetupResult;
}): Promise<void> {
  for (const user of page) {
    result.scanned += 1;
    try {
      const outcome = await resolveUser({
        user,
        writer,
        organizations,
        isDryRun,
      });
      result[outcome] += 1;
    } catch (error) {
      result.failed += 1;
      logger.error({ error, userId: user.id }, "failed to process user");
    }
  }
}

/**
 * Pure paging loop over the candidate users, deciding per user whether the
 * stored `pendingSsoSetup` flag still matches reality and clearing it when it
 * does not.
 */
export async function clearStalePendingSsoSetup({
  users,
  writer,
  organizations,
  isDryRun,
  batchSize = BATCH_SIZE,
}: {
  users: CandidateUserPage;
  writer: PendingSsoSetupWriter;
  organizations: OrganizationSsoProviderLookup;
  isDryRun: boolean;
  batchSize?: number;
}): Promise<ClearStalePendingSsoSetupResult> {
  const cachedOrganizations = cachedOrganizationLookup(organizations);

  const result: ClearStalePendingSsoSetupResult = {
    scanned: 0,
    cleared: 0,
    stillPending: 0,
    skipped: 0,
    failed: 0,
    isDryRun,
  };

  let cursorId: string | null = null;
  for (;;) {
    const page = await users.findPendingSsoSetupPage({
      cursorId,
      take: batchSize,
    });
    if (page.length === 0) break;

    await resolvePage({
      page,
      writer,
      organizations: cachedOrganizations,
      isDryRun,
      result,
    });

    cursorId = page[page.length - 1]?.id ?? null;
    if (page.length < batchSize) break;
  }

  return result;
}

class PrismaCandidateUserPage implements CandidateUserPage {
  async findPendingSsoSetupPage({
    cursorId,
    take,
  }: {
    cursorId: string | null;
    take: number;
  }): Promise<CandidateUser[]> {
    return prisma.user.findMany({
      where: {
        pendingSsoSetup: true,
        ...(cursorId ? { id: { gt: cursorId } } : {}),
      },
      select: {
        id: true,
        email: true,
        accounts: {
          select: { provider: true, providerAccountId: true },
        },
      },
      orderBy: { id: "asc" },
      take,
    });
  }
}

class PrismaPendingSsoSetupWriter implements PendingSsoSetupWriter {
  async clearPendingSsoSetup({ id }: { id: string }): Promise<void> {
    await prisma.user.update({
      where: { id },
      data: { pendingSsoSetup: false },
    });
  }
}

export default async function main(...args: string[]) {
  const isDryRun = args.includes("--dry-run") || process.env.DRY_RUN === "1";

  const result = await clearStalePendingSsoSetup({
    users: new PrismaCandidateUserPage(),
    writer: new PrismaPendingSsoSetupWriter(),
    organizations: new PrismaLegacySsoOrganizationRepository(prisma),
    isDryRun,
  });

  logger.info(result, "finished clearing stale pending SSO setup flags");
}
