import { identifierDomain, normalizeIdentifierValue } from "./identifier.ts";

/** Determines which organizations will accept an address for joining based on domain verification,
 * member status, and join settings. See ADR-117 D12 for the security model.
 */

/**
 * Joining, as an organization has set it. `auto` is never inferred — an
 * administrator turns it on and names the domain.
 */
export const DOMAIN_JOIN_SETTINGS = ["off", "request", "auto"] as const;
export type DomainJoinSetting = (typeof DOMAIN_JOIN_SETTINGS)[number];

/** What a newly created self-serve organization starts on. */
export const DEFAULT_DOMAIN_JOIN_SETTING: DomainJoinSetting = "request";

/**
 * Asking to join needs ONE member holding a verified address on the domain:
 * the ask reveals nothing on its own and an admin gates the outcome.
 */
export const JOIN_REQUEST_VERIFIED_MEMBER_THRESHOLD = 1;

/**
 * Auto-join needs a second verified member as corroboration: one colleague at
 * a personal-looking address is not proof a company owns the domain.
 */

/** A maintained deny-list of consumer email providers to prevent public addresses from enabling org
 * matching or automatic joining. Prevents exposing who works where by matching strangers.
 */
export const PUBLIC_EMAIL_DOMAINS: readonly string[] = [
  "126.com",
  "163.com",
  "aol.com",
  "duck.com",
  "fastmail.com",
  "free.fr",
  "freenet.de",
  "gmail.com",
  "gmx.at",
  "gmx.ch",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "googlemail.com",
  "hey.com",
  "hotmail.be",
  "hotmail.co.uk",
  "hotmail.com",
  "hotmail.de",
  "hotmail.es",
  "hotmail.fr",
  "hotmail.it",
  "hotmail.nl",
  "icloud.com",
  "laposte.net",
  "libero.it",
  "live.be",
  "live.co.uk",
  "live.com",
  "live.de",
  "live.fr",
  "live.it",
  "live.nl",
  "mac.com",
  "mail.com",
  "mail.ru",
  "me.com",
  "msn.com",
  "naver.com",
  "orange.fr",
  "outlook.com",
  "outlook.de",
  "outlook.es",
  "outlook.fr",
  "outlook.it",
  "pm.me",
  "proton.me",
  "protonmail.com",
  "qq.com",
  "rediffmail.com",
  "seznam.cz",
  "sfr.fr",
  "t-online.de",
  "uol.com.br",
  "wanadoo.fr",
  "web.de",
  "yahoo.ca",
  "yahoo.co.jp",
  "yahoo.co.uk",
  "yahoo.com",
  "yahoo.com.au",
  "yahoo.com.br",
  "yahoo.de",
  "yahoo.es",
  "yahoo.fr",
  "yahoo.it",
  "yandex.com",
  "yandex.ru",
  "ymail.com",
  "zoho.com",
];

const PUBLIC_EMAIL_DOMAIN_SET = new Set(PUBLIC_EMAIL_DOMAINS);

/** Checks if a domain is a consumer mail provider using the same normalization as attach-time
 * processing. Subdomains are not treated as public.
 */
export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAIN_SET.has(domain.trim().toLowerCase());
}

/**
 * The domain a join decision is made on, normalized exactly as attach-time
 * does (NFKC fold, lowercase, trim, plus-tag stripped). Null when not
 * email-shaped.
 */
export function joinDomainOf(email: string): string | null {
  return identifierDomain(normalizeIdentifierValue(email));
}

/** One organization, as the matcher needs to see it. Everything here is a
 *  count or a flag: no member of any organization is ever named to make a
 *  join decision. */
export interface JoinCandidateOrganization {
  organizationId: string;
  name: string;
  domainJoin: DomainJoinSetting;
  /** True when an ACTIVE SSO connection already admits this domain. Its own
   *  provisioning is the way in, so joining is not offered beside it. */
  connectionAdmitsDomain: boolean;
  /** Members holding a VERIFIED identifier on the looked-up domain.
   *  Unverified addresses are not evidence and do not count. */
  verifiedMembersOnDomain: number;
  /** Total members, for the coarse colleague count. */
  memberCount: number;
  /** The domains an administrator named when turning automatic joining on.
   *  Empty means automatic joining admits nobody, whatever the setting says. */
  autoJoinDomains: readonly string[];
  /**
   * A live proof this organization CONTROLS the domain (ADR-123), which is
   * what authorizes walking straight in. Verified members are not that, and
   * a lapsed proof reads as none.
   */
  domainProved: boolean;
}

/** What is safe to say about an organization to somebody who is not in it:
 *  its name, and roughly how many people are. Never a member, never a role. */
export interface JoinOffer {
  organizationId: string;
  name: string;
  /** Rounded (see {@link coarseColleagueCount}) — never the exact number. */
  colleagueCount: number;
}

/**
 * The decision. `none` covers every refusal identically — no domain, joining
 * off, unverified address — so a caller cannot tell them apart.
 */
export type JoinLookupDecision =
  | { outcome: "none" }
  | { outcome: "ask"; organizations: readonly JoinOffer[] }
  | { outcome: "auto"; organization: JoinOffer };

/**
 * Round a member count down to something a stranger may see: exact below ten
 * (rounding a small team to zero would say nothing), bucketed above it.
 */
export function coarseColleagueCount(memberCount: number): number {
  if (memberCount <= 0) return 0;
  if (memberCount < 10) return memberCount;
  if (memberCount < 100) return Math.floor(memberCount / 10) * 10;
  if (memberCount < 1000) return Math.floor(memberCount / 50) * 50;
  return Math.floor(memberCount / 100) * 100;
}

function offerOf(organization: JoinCandidateOrganization): JoinOffer {
  return {
    organizationId: organization.organizationId,
    name: organization.name,
    colleagueCount: coarseColleagueCount(organization.memberCount),
  };
}

export interface JoinLookupInput {
  /** The address as typed. Nothing is looked up unless it is verified. */
  email: string;
  /** Whether the person has PROVED this address. The gate, not a hint: an
   *  unverified address never reaches the organization list at all. */
  verified: boolean;
  organizations: readonly JoinCandidateOrganization[];
  /**
   * Whether this deployment may admit people automatically. Unlicensed
   * deployments fall every `auto` organization back to `request` instead.
   */
  autoJoinLicensed: boolean;
}

/**
 * Which organizations are open to an address, and whether one takes it
 * without asking. Auto-join is not a second mechanism — the request is still
 * made and approved by policy; only who resolves it differs.
 */
export function resolveJoinLookup({
  email,
  verified,
  organizations,
  autoJoinLicensed,
}: JoinLookupInput): JoinLookupDecision {
  if (!verified) return { outcome: "none" };

  const domain = joinDomainOf(email);
  if (!domain) return { outcome: "none" };
  if (isPublicEmailDomain(domain)) return { outcome: "none" };

  const open = organizations.filter((organization) =>
    organizationAdmitsDomain({ organization, domain }),
  );
  if (open.length === 0) return { outcome: "none" };

  if (autoJoinLicensed) {
    const automatic = open.filter((organization) =>
      organizationAdmitsDomainAutomatically({ organization, domain }),
    );
    // Exactly one, or nobody walks in. A domain matching two `auto`
    // organizations is a domain we cannot tell apart, and guessing which
    // company somebody works for is the one thing this must never do.
    if (automatic.length === 1 && automatic[0]) {
      return { outcome: "auto", organization: offerOf(automatic[0]) };
    }
  }

  return { outcome: "ask", organizations: open.map(offerOf) };
}

/** Whether an organization is open to a domain at all — the funnel every
 *  mode passes through, automatic included. */
export function organizationAdmitsDomain({
  organization,
  domain,
}: {
  organization: JoinCandidateOrganization;
  domain: string;
}): boolean {
  if (isPublicEmailDomain(domain)) return false;
  if (organization.connectionAdmitsDomain) return false;
  if (organization.domainJoin === "off") return false;
  return organization.verifiedMembersOnDomain >= JOIN_REQUEST_VERIFIED_MEMBER_THRESHOLD;
}

/**
 * Whether an organization admits a domain WITHOUT an admin clicking: the
 * setting is `auto`, an administrator named this exact domain, and a second
 * verified member corroborates that the company owns it.
 */
export function organizationAdmitsDomainAutomatically({
  organization,
  domain,
}: {
  organization: JoinCandidateOrganization;
  domain: string;
}): boolean {
  if (!organizationAdmitsDomain({ organization, domain })) return false;
  if (organization.domainJoin !== "auto") return false;
  if (!organization.autoJoinDomains.includes(domain)) return false;

  // A lapsed proof reads as no proof: the domain stopped vouching for new
  // people when its record stayed missing through the grace (ADR-123).
  return organization.domainProved;
}
