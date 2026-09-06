import { identifierDomain, normalizeIdentifierValue } from "./identifier";

/**
 * Which organizations will take an address (ADR-117, D12). One question, and
 * the answer is the most dangerous thing in the deliverable: a lookup that
 * answers freely is a directory of who works where.
 *
 *   address ──not verified yet──────────────► nothing, ever
 *           ──public email domain───────────► nothing, structurally
 *           ──verified, domain d────────────► organizations where
 *                                              · at least one member holds a
 *                                                VERIFIED address on d
 *                                              · no ACTIVE SSO connection
 *                                                admits people already
 *                                              · joining is not turned off
 *
 * Everything outside that funnel answers with the same nothing. "No such
 * organization", "closed to you" and "you have not verified yet" are ONE
 * answer, because telling them apart is the leak — which is why this module
 * returns a decision and never a reason.
 *
 * There is deliberately NO "personal organization" exclusion, and its absence
 * is a decision rather than an omission. This schema has no such concept —
 * `Team.isPersonal` and `Project.isPersonal` are per-member workspaces INSIDE
 * an organization, and every organization the product creates gets a shared
 * team — so a predicate for it could only ever be inert. The privacy it was
 * reaching for is held by the rules above instead: a consumer domain is
 * structurally excluded, automatic joining needs an admin-named domain AND two
 * verified members (which one person cannot be), and the request path ends
 * with an administrator who is free to ignore it.
 *
 * What is left is the solo WORK organization — one person at a real company
 * domain — and offering that is the orphan-organization fix doing its job. The
 * asker learns only that somebody at a domain they have already proved they
 * hold uses LangWatch, and the person there decides.
 *
 * Pure, like the rest of the package: the caller reads the organizations and
 * their verified-member counts, this decides. That split is what lets the
 * whole rule be unit-tested without a database.
 */

/**
 * Joining, as an organization has set it.
 *
 * `request` is the default for a self-serve organization; `auto` is never a
 * default and never inferred — an administrator turns it on and names the
 * domain while doing it.
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
 * Walking in automatically needs more, because nobody gates it. One colleague
 * with a personal-looking address at a small vendor is not evidence a company
 * owns a domain; the administrator naming the domain, plus corroboration from
 * a second verified member, is.
 */
export const JOIN_AUTO_VERIFIED_MEMBER_THRESHOLD = 2;

/**
 * Consumer mail providers, which are not companies.
 *
 * This list is the STRUCTURAL half of "a public email domain never matches":
 * one match on a consumer provider would offer strangers to each other by the
 * million, so the exclusion has to be impossible rather than unlikely. It is
 * applied in every mode — lookup, request and automatic — and an
 * administrator cannot turn automatic joining on for one of these at all.
 *
 * Deliberately a maintained deny-list rather than a heuristic: a probability
 * that gmail.com is a company is a probability of the worst leak this
 * deliverable can produce.
 */
export const PUBLIC_EMAIL_DOMAINS: readonly string[] = [
  "aol.com",
  "duck.com",
  "fastmail.com",
  "gmail.com",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "googlemail.com",
  "hey.com",
  "hotmail.co.uk",
  "hotmail.com",
  "hotmail.fr",
  "icloud.com",
  "live.co.uk",
  "live.com",
  "mac.com",
  "mail.com",
  "mail.ru",
  "me.com",
  "msn.com",
  "outlook.com",
  "pm.me",
  "prontonmail.com",
  "proton.me",
  "protonmail.com",
  "qq.com",
  "yahoo.co.jp",
  "yahoo.co.uk",
  "yahoo.com",
  "yandex.com",
  "yandex.ru",
  "ymail.com",
  "zoho.com",
];

const PUBLIC_EMAIL_DOMAIN_SET = new Set(PUBLIC_EMAIL_DOMAINS);

/**
 * Whether a domain is a consumer mail provider. Compares the domain in the
 * fold `normalizeDomain` / `identifierDomain` produce, so a lookup and an
 * attach can never disagree about what "gmail.com" is.
 *
 * Subdomains are NOT treated as public: `mail.acme.com` is not `acme.com`,
 * and the same strictness that keeps a lookalike domain from matching a
 * company keeps it from being waved through as consumer mail.
 */
export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAIN_SET.has(domain.trim().toLowerCase());
}

/**
 * The domain a join decision is made on: the tail of the address after the
 * SAME normalization attach-time uses (NFKC fold, lowercase, trim, plus-tag
 * stripped). Null for anything that is not email-shaped — which answers the
 * same nothing every other refusal does.
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
 * The decision. `none` is the ONE answer every refusal gives: a domain nobody
 * holds, an organization that turned joining off, and an address nobody has
 * verified are field-for-field identical here, and a caller that wanted to
 * tell them apart has nothing to read.
 */
export type JoinLookupDecision =
  | { outcome: "none" }
  | { outcome: "ask"; organizations: readonly JoinOffer[] }
  | { outcome: "auto"; organization: JoinOffer };

/**
 * Round a member count down to something a stranger may see.
 *
 * Exact below ten, because "3 of your colleagues" is the whole signal for a
 * small team and rounding it to zero would say nothing; buckets above that,
 * because the difference between 117 and 118 members is the organization's
 * business and not the visitor's.
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
   * Whether this deployment may admit people automatically. The licence gate
   * holds `auto` and lets `request` through — automatic joining is
   * federation, asking is not — so an unlicensed deployment sees every `auto`
   * organization fall back to asking rather than disappear.
   */
  autoJoinLicensed: boolean;
}

/**
 * Which organizations are open to an address, and whether one of them takes
 * it without asking.
 *
 * Auto-join is not a second mechanism: an `auto` answer still means a request
 * is made, and it is approved by policy the moment it is. What differs is
 * only who resolves it.
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
  return (
    organization.verifiedMembersOnDomain >=
    JOIN_REQUEST_VERIFIED_MEMBER_THRESHOLD
  );
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
  return (
    organization.verifiedMembersOnDomain >= JOIN_AUTO_VERIFIED_MEMBER_THRESHOLD
  );
}
