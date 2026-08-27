import { parseLicenseKey, verifySignature } from "@ee/licensing/validation";
import { platformSSOAllowed } from "@ee/sso/sso-gate";
import type { ISsoLicenseRepository } from "@ee/sso/sso-license.repository";
import type {
  SsoDomainVerification,
  SsoSelfServeContext,
} from "@langwatch/identity";
import type {
  SsoBreakGlassWarningNotifier,
  SsoDomainProofLookup,
  SsoDomainReproofNotifier,
  SsoDomainReproofTarget,
  SsoDomainReproofTargetRepository,
  SsoDomainTxtLookup,
  SsoLicenseAuthorityRepository,
  SsoLicenseProofPort,
  SsoOrganizationMember,
  SsoOrganizationMemberLookup,
  SsoSelfServeContextPort,
  SsoTestSignIn,
  SsoTestSignInLookup,
} from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import { Resolver } from "dns/promises";
import { env } from "~/env.mjs";
import {
  OrganizationUserRole,
  type PrismaClient,
} from "~/generated/prisma/client";
import { NOT_TARGETED } from "~/server/featureFlag";
import type { FeatureFlagService } from "~/server/featureFlag/featureFlag.service";
import { buildAccessSettingsUrl } from "~/server/invites/invite-link";
import {
  sendSsoDomainProofLapsedEmail,
  sendSsoDomainProofWaveringEmail,
} from "~/server/mailer/ssoDomainProofEmails";
import { errorCodeOf } from "./sso-domain-file-lookup";

const logger = createLogger("langwatch:identity:sso-self-serve");

/**
 * What the installation's licence may authorize (D05 tier 2).
 *
 * The answer is ADR-027's gate, unchanged and for the same reason: it is
 * decided once per process, so a licence activated while the installation is
 * running does not change what this process federates until it restarts.
 * Reusing the gate rather than reading a licence here is deliberate — two
 * modules deciding what "licensed" means would eventually disagree, and the
 * disagreement would be about who gets single sign-on.
 *
 * On the hosted service the answer is always NO, which is not the same
 * answer `platformSSOAllowed` gives: hosted short-circuits to true there
 * because every hosted customer may federate. What a licence cannot do on
 * hosted is stand in for an operator's approval of a domain — there is no
 * instance licence to speak for the installation, and the claim queue is
 * right there.
 */
export class LicenseDomainClaimAuthority
  implements SsoLicenseAuthorityRepository
{
  constructor(private readonly isHosted: () => boolean = () => !!env.IS_SAAS) {}

  async licenseAuthorizesDomainClaims(): Promise<boolean> {
    if (this.isHosted()) return false;
    return platformSSOAllowed();
  }
}

/**
 * The licence key itself, for the one purpose a licence key is used for
 * here: hashing it into the proof fact. The key never leaves this method and
 * never reaches a command, a fact or a response.
 */
export class InstanceLicenseProof implements SsoLicenseProofPort {
  constructor(private readonly licenses: ISsoLicenseRepository) {}

  async currentLicenseKey(): Promise<string | null> {
    const instance = env.LANGWATCH_LICENSE_KEY;
    if (instance && isGenuine(instance)) return instance;
    // The same candidate scan the sign-in gate runs, through the same
    // repository — one query shape, so "which licences count" cannot drift
    // between the gate and the thing that hashes one into a proof.
    for (const candidate of await this.licenses.findOrganizationsWithLicense()) {
      if (isGenuine(candidate.license)) return candidate.license;
    }
    return null;
  }
}

function isGenuine(licenseKey: string): boolean {
  const parsed = parseLicenseKey(licenseKey);
  // Expiry is deliberately irrelevant, exactly as it is for the sign-in gate
  // (ADR-027 decision 1): once a customer, never blocked.
  return parsed !== null && verifySignature(parsed);
}

/**
 * Which tier an organization gets, assembled from the deployment, the frozen
 * licence gate and the per-organization flag.
 *
 * `licenseActivatedSinceStart` is the honest half of the restart story: the
 * gate is frozen, so a licence activated a minute ago is genuine and still
 * changes nothing until the installation restarts. Reading the store live
 * here is what lets the surface say "restart" instead of "no licence", which
 * are two very different things to be told when you have just paid.
 */
export class SsoSelfServeContextResolver implements SsoSelfServeContextPort {
  constructor(
    private readonly deps: {
      featureFlags: FeatureFlagService;
      licenseProof: SsoLicenseProofPort;
      isHosted?: () => boolean;
      /** The frozen gate. Injected so a test can hold an installation that
       *  started unlicensed without restarting a process. */
      licensedAtStartup?: () => Promise<boolean>;
    },
  ) {}

  async resolve({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<SsoSelfServeContext> {
    const isHosted = this.deps.isHosted ?? (() => !!env.IS_SAAS);
    const deployment = isHosted() ? "hosted" : "self-hosted";
    const licensed = await (
      this.deps.licensedAtStartup ?? platformSSOAllowed
    )();
    return {
      deployment,
      licensed: deployment === "self-hosted" ? licensed : false,
      licenseActivatedSinceStart:
        deployment === "self-hosted" && !licensed
          ? (await this.deps.licenseProof.currentLicenseKey()) !== null
          : false,
      optedIn:
        deployment === "hosted"
          ? await this.deps.featureFlags.isEnabled("self_serve_sso", {
              organizationId,
              // An organization-level flag: no project is in scope here, and
              // NOT_TARGETED is what says so rather than an absent id.
              projectId: NOT_TARGETED,
              distinctId: organizationId,
            })
          : false,
    };
  }
}

/**
 * The one thing this adapter needs of DNS, so a test never touches it.
 *
 * Narrower than `Resolver` on purpose: a stub implements one method with the
 * shape node returns (a record is a list of character-strings, which is why
 * it is an array of arrays), and the classification below is what is
 * actually under test.
 */
export interface TxtRecordResolver {
  resolveTxt(name: string): Promise<string[][]>;
}

/**
 * Which resolver answers mean "nothing is published there".
 *
 * `ENOTFOUND` is no such name and `ENODATA` is a name with no TXT record on
 * it. Both are the resolver successfully telling us the record is not there,
 * which is a fact about the customer's DNS and something they can act on.
 * Everything else — SERVFAIL, REFUSED, a timeout, a malformed response — is
 * the lookup failing to happen, which is a fact about US.
 */
const ABSENT_CODES = new Set(["ENOTFOUND", "ENODATA", "NOTFOUND", "NODATA"]);

/**
 * How long we wait for an answer, and how many times we ask.
 *
 * Bounded because this runs inside a request an administrator is watching:
 * node's default is five seconds per try over four tries, so an
 * unresponsive nameserver would hold the page for twenty. Two tries of three
 * seconds gives a slow-but-working resolver room and still answers the
 * screen inside a timeframe a person will wait through.
 */
const LOOKUP_TIMEOUT_MS = 3_000;
const LOOKUP_TRIES = 2;

/**
 * The resolver a proof lookup asks, and the one case where it is not the
 * machine's own.
 *
 * A DOMAIN NOBODY OWNS CANNOT BE PROVED AGAINST THE PUBLIC INTERNET, which
 * is the whole of local development: a developer walking this journey types
 * something like `acme.test`, a reserved name that every real resolver
 * answers NXDOMAIN for, and the ceremony can never finish. Our identity
 * provider simulator already answers TXT for exactly those names on a
 * nameserver of its own — the missing piece was only ever that nothing told
 * this lookup to ask it.
 *
 * `SSO_DOMAIN_PROOF_DNS_SERVERS` names that nameserver, as node's
 * `setServers` shape: `127.0.0.1:15353`, or `[::1]:15353` for IPv6, comma
 * separated.
 *
 * LOCAL ONLY, because local is the only place it is needed. A deployed
 * installation proves real domains against real DNS, and the one thing this
 * variable could do there is quietly point domain ownership — the evidence
 * the whole ceremony rests on — at a nameserver somebody chose. There is no
 * case for that we have been asked for, so it is read outside production and
 * ignored inside it.
 */
function nameserverBackedResolver(): TxtRecordResolver {
  const resolver = new Resolver({
    timeout: LOOKUP_TIMEOUT_MS,
    tries: LOOKUP_TRIES,
  });
  if (env.NODE_ENV === "production") return resolver;

  const configured: string = env.SSO_DOMAIN_PROOF_DNS_SERVERS ?? "";
  const servers = configured
    .split(/[\s,]+/)
    .filter((entry: string) => entry !== "");
  if (servers.length === 0) return resolver;

  try {
    resolver.setServers(servers);
    logger.info(
      { servers },
      "single sign-on domain proofs resolve against a configured nameserver",
    );
  } catch (error) {
    // A malformed value must not take domain proof down with it: the
    // machine's own resolver is a working answer, and the misconfiguration
    // is worth a line rather than a dead ceremony.
    logger.warn(
      { servers, error },
      "SSO_DOMAIN_PROOF_DNS_SERVERS could not be applied; using the system resolver",
    );
  }
  return resolver;
}

/**
 * Reading the record a customer published.
 *
 * A plain DNS lookup with no cache of our own: the resolver's cache is the
 * one that matters, and a second cache here would tell a customer their
 * freshly-published record is still missing minutes after it went live.
 *
 * What it does NOT do any more is collapse every failure into "nothing
 * published". A SERVFAIL and an empty zone are different facts, and only one
 * of them is the customer's to fix — telling an administrator to publish a
 * record they already published, because our resolver timed out, sends them
 * to argue with a DNS team about nothing.
 */
export class DnsDomainProofLookup implements SsoDomainProofLookup {
  private readonly resolver: TxtRecordResolver;

  constructor({ resolver }: { resolver?: TxtRecordResolver } = {}) {
    this.resolver = resolver ?? nameserverBackedResolver();
  }

  async lookupTxtValues({
    name,
  }: {
    domain: string;
    name: string;
  }): Promise<SsoDomainTxtLookup> {
    try {
      // A TXT record is a list of character-strings; a value longer than 255
      // characters arrives split, and joining is how it becomes the string
      // the customer pasted in.
      const values = (await this.resolver.resolveTxt(name)).map((chunks) =>
        chunks.join(""),
      );
      if (values.length === 0) return { outcome: "absent" };
      return { outcome: "published", values };
    } catch (error) {
      const code = errorCodeOf(error);
      if (code && ABSENT_CODES.has(code)) {
        logger.info({ name, code }, "no verification record is published");
        return { outcome: "absent" };
      }
      // Logged as a warning rather than an error: it is a real failure and
      // it is also a nameserver having a bad minute, which is neither ours
      // to page on nor the customer's to be blamed for.
      logger.warn(
        { name, code, error },
        "the verification record could not be looked up",
      );
      return { outcome: "unreachable", reason: code ?? "lookup_failed" };
    }
  }
}

/**
 * Which domains a sweep re-reads (ADR-123).
 *
 * Three filters, and each one excludes a domain a DNS answer could not
 * honestly speak about:
 *
 * - The connection is VERIFIED or ACTIVE. A suspended or torn-down
 *   connection's domains route nothing, so doubting them would produce
 *   alerts about a door nobody can open.
 * - The proof was made by a published record. An attested domain, a
 *   licence-bound one and a grandfathered one have no record to be missing,
 *   and asking DNS about them would find nothing and lapse every one of them.
 * - The ceremony's hash is on the row. Without it a re-read cannot compare
 *   the value it finds, and "something is published at our name" is not
 *   evidence of anything. Domains proved before the hash was carried forward
 *   are therefore left exactly as they were rather than being judged on a
 *   comparison we cannot make.
 *
 * Cross-organization on purpose, like the ownership read next door: the sweep
 * is the platform's, and `SsoConnection` is exempt from the organization
 * guard on precisely that ground.
 */
export class PrismaSsoDomainReproofTargets
  implements SsoDomainReproofTargetRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  /** The look is its own fact — see the port's note on why the sweep cannot
   *  order by anything the re-read writes. */
  async markSwept({
    connectionIds,
    atMs,
  }: {
    connectionIds: readonly string[];
    atMs: number;
  }): Promise<void> {
    if (connectionIds.length === 0) return;
    await this.prisma.ssoConnection.updateMany({
      where: { id: { in: [...connectionIds] } },
      data: { lastReproofAt: new Date(atMs) },
    });
  }

  async findDomainsProvedByRecord({
    limit,
  }: {
    limit: number;
  }): Promise<SsoDomainReproofTarget[]> {
    const rows = await this.prisma.ssoConnection.findMany({
      where: {
        state: { in: ["VERIFIED", "ACTIVE"] },
        NOT: { verifiedDomains: { isEmpty: true } },
      },
      select: {
        id: true,
        organizationId: true,
        verifiedDomains: true,
        domainVerifications: true,
      },
      // THE LOOK, NOT THE WRITE. `updatedAt` does not move on a healthy
      // re-read (no facts are emitted), so ordering by it re-read the same
      // prefix every cycle — and a domain that started wavering DID bump it,
      // sorting the one domain in its grace window out of the batch and
      // leaving it never to lapse. `lastReproofAt` is stamped on every
      // target the sweep takes, whatever it finds, so coverage is genuinely
      // round-robin. Null sorts first, so a connection never looked at is
      // looked at soonest.
      orderBy: [{ lastReproofAt: { sort: "asc", nulls: "first" } }],
      take: limit,
    });
    return rows.flatMap((row) => {
      const proofs = Array.isArray(row.domainVerifications)
        ? (row.domainVerifications as unknown as SsoDomainVerification[])
        : [];
      return proofs.flatMap((proof): SsoDomainReproofTarget[] => {
        if (proof.method !== "dns-txt" && proof.method !== "https-file") {
          return [];
        }
        if (!proof.tokenHash) return [];
        if (!row.verifiedDomains.includes(proof.domain)) return [];
        return [
          {
            connectionId: row.id,
            organizationId: row.organizationId,
            domain: proof.domain,
            tokenHash: proof.tokenHash,
            method: proof.method,
          },
        ];
      });
    });
  }
}

/**
 * Who is told the evidence behind their domain is going, and then gone
 * (ADR-123).
 *
 * Every administrator, because any of them can fix it and none of them is
 * more responsible for DNS than the others. Failures are logged and never
 * thrown: a deployment with no email provider configured is an ordinary
 * self-hosted install, and a domain must still waver and still lapse there —
 * the alert is a courtesy, and the rule is the rule.
 */
export class EmailSsoDomainReproofNotifier implements SsoDomainReproofNotifier {
  constructor(private readonly prisma: PrismaClient) {}

  async wavering({
    organizationId,
    domain,
    graceEndsAtMs,
  }: Parameters<SsoDomainReproofNotifier["wavering"]>[0]): Promise<void> {
    const [organizationName, adminEmails] = await Promise.all([
      this.organizationName({ organizationId }),
      this.adminEmails({ organizationId }),
    ]);
    await this.fanOut({
      what: "sso domain proof wavering",
      domain,
      sends: adminEmails.map((adminEmail) =>
        sendSsoDomainProofWaveringEmail({
          adminEmail,
          organizationName,
          domain,
          deadline: new Date(graceEndsAtMs),
          accessSettingsUrl: buildAccessSettingsUrl(),
        }),
      ),
    });
  }

  async lapsed({
    organizationId,
    domain,
  }: Parameters<SsoDomainReproofNotifier["lapsed"]>[0]): Promise<void> {
    const [organizationName, adminEmails] = await Promise.all([
      this.organizationName({ organizationId }),
      this.adminEmails({ organizationId }),
    ]);
    await this.fanOut({
      what: "sso domain proof lapsed",
      domain,
      sends: adminEmails.map((adminEmail) =>
        sendSsoDomainProofLapsedEmail({
          adminEmail,
          organizationName,
          domain,
          accessSettingsUrl: buildAccessSettingsUrl(),
        }),
      ),
    });
  }

  private async fanOut({
    what,
    domain,
    sends,
  }: {
    what: string;
    domain: string;
    sends: Promise<void>[];
  }): Promise<void> {
    const settled = await Promise.allSettled(sends);
    const failed = settled.filter((result) => result.status === "rejected");
    if (failed.length > 0) {
      logger.warn(
        { what, domain, failed: failed.length, of: settled.length },
        "could not tell every administrator about a domain's verification record",
      );
    }
  }

  private async organizationName({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<string> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    return organization?.name ?? "your organization";
  }

  private async adminEmails({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<string[]> {
    const admins = await this.prisma.organizationUser.findMany({
      where: {
        organizationId,
        role: OrganizationUserRole.ADMIN,
        disabledAt: null,
      },
      select: { user: { select: { email: true } } },
    });
    return admins
      .map((admin) => admin.user.email)
      .filter((email): email is string => Boolean(email));
  }
}

/**
 * Whether anybody has actually come back through a connection (wave 3).
 *
 * The engine writes an account when the identity provider hands a person
 * back, and its `provider` column is the connection's own id — so the
 * account IS the evidence that the connection carries a real sign-in, and
 * nothing has to be written down separately. That is what makes "a customer
 * cannot tick this box by clicking a button" true by construction rather
 * than by a check somebody could delete.
 *
 * THE CONNECTION IS WHAT SCOPES THIS, NOT THE SIGNER'S MEMBERSHIP. It used to
 * require that the person who came back is already a member of the
 * organization, and that is the one thing a test sign-in cannot promise: the
 * step exists to prove the connection carries a real person BEFORE anybody is
 * provisioned through it, and on a connection that is not live yet nobody is.
 * So the customer signed in successfully, came back, and the step still read
 * "do this next" — with the screen insisting nothing was wrong.
 *
 * Dropping the join costs nothing, because `SsoConnection.organizationId`
 * means a connection belongs to exactly one organization: an account whose
 * `provider` is this connection's id came through this organization's
 * provider and no other. The organization is still CONFIRMED rather than
 * assumed — the connection is looked up under it first, so a connection id
 * from another tenant answers null exactly as it did before.
 */
export class PrismaSsoTestSignInLookup implements SsoTestSignInLookup {
  constructor(private readonly prisma: PrismaClient) {}

  async findLatestForConnection({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }): Promise<SsoTestSignIn | null> {
    // The connection under THIS organization, which is what makes the account
    // lookup below org-scoped without asking anything of the signer.
    const connection = await this.prisma.ssoConnection.findFirst({
      where: { id: connectionId, organizationId },
      select: { id: true },
    });
    if (!connection) return null;

    const account = await this.prisma.account.findFirst({
      where: { provider: connectionId },
      select: { id: true, userId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    if (!account) return null;
    return {
      accountId: account.id,
      userId: account.userId,
      atMs: account.createdAt.getTime(),
    };
  }
}

/**
 * Who a way back in can be granted to, and who holds one.
 *
 * The candidates are the organization's active administrators, which is the
 * smallest honest list: granting somebody a door the rest of the
 * organization does not have is a decision of the same weight as making them
 * an administrator, and a picker over every member would invite the wrong
 * one.
 *
 * Holders are looked up by id WITHOUT the administrator filter. A binding
 * whose holder has since stopped being an administrator is still a way in,
 * and a list that quietly dropped them would be a list nobody could audit.
 */
export class PrismaSsoOrganizationMemberLookup
  implements SsoOrganizationMemberLookup
{
  constructor(private readonly prisma: PrismaClient) {}

  async findAdministrators({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<SsoOrganizationMember[]> {
    const members = await this.prisma.organizationUser.findMany({
      where: {
        organizationId,
        role: OrganizationUserRole.ADMIN,
        disabledAt: null,
      },
      select: { user: { select: { id: true, name: true, email: true } } },
    });
    return members.map(toMember);
  }

  async findByIds({
    organizationId,
    userIds,
  }: {
    organizationId: string;
    userIds: string[];
  }): Promise<SsoOrganizationMember[]> {
    if (userIds.length === 0) return [];
    const members = await this.prisma.organizationUser.findMany({
      where: { organizationId, userId: { in: userIds } },
      select: { user: { select: { id: true, name: true, email: true } } },
    });
    return members.map(toMember);
  }
}

function toMember(row: {
  user: { id: string; name: string | null; email: string | null };
}): SsoOrganizationMember {
  return {
    userId: row.user.id,
    name: row.user.name,
    email: row.user.email,
  };
}

/**
 * Who is told a way back in is ending.
 *
 * A log line for now, and deliberately one that names the person and the
 * date: the warning has to be actionable by whoever reads it, and an
 * operator reading "a break-glass binding expires soon" has been told
 * nothing. Wiring it to email is a change of this class alone.
 */
export class LoggingBreakGlassWarningNotifier
  implements SsoBreakGlassWarningNotifier
{
  async warn({
    binding,
    daysRemaining,
  }: Parameters<SsoBreakGlassWarningNotifier["warn"]>[0]): Promise<void> {
    logger.warn(
      {
        organizationId: binding.organizationId,
        userId: binding.userId,
        grantedByUserId: binding.grantedByUserId,
        expiresAt: new Date(binding.expiresAtMs).toISOString(),
        daysRemaining,
      },
      "a way back in without the identity provider is ending; renew it or activation will be refused after it does",
    );
  }
}
