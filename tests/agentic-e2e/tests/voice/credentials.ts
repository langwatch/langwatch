/**
 * Credential and project setup for the voice-agent contract steps.
 *
 * Covers the env-var credential gates the contract tests skip on, and
 * provisioning the project with the provider key a call needs to sign with —
 * using the same authenticated `page.request` path `auth.setup.ts` uses to
 * provision the org and project, so the drawer's "no key in this project"
 * branch is not what the test exercises.
 *
 * @see ../voice-agent-contract.spec.ts
 */
import { type APIResponse, type Page, expect } from "@playwright/test";

import { getProjectSlug } from "../helpers";

// =============================================================================
// Credentials — the tests gate on these, they never hardcode a secret
// =============================================================================

export type PhoneCreds = {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  toNumber: string;
};

export type ElevenLabsCreds = {
  apiKey: string;
  agentId: string;
};

/** The Twilio + callee credentials a phone call needs, or null if any is unset. */
export function phoneCredsFromEnv(): PhoneCreds | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  const toNumber = process.env.E2E_VOICE_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber || !toNumber) return null;
  return { accountSid, authToken, fromNumber, toNumber };
}

/** The ElevenLabs credentials a ConvAI call needs, or null if any is unset. */
export function elevenLabsCredsFromEnv(): ElevenLabsCreds | null {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.E2E_ELEVENLABS_AGENT_ID;
  if (!apiKey || !agentId) return null;
  return { apiKey, agentId };
}

// =============================================================================
// Background
// =============================================================================

/** Background: Given a LangWatch user with a project. */
export async function givenAUserWithAProject(page: Page) {
  await page.goto("/");
  await expect(page).not.toHaveURL(/\/auth\//);
}

/**
 * Fails a step immediately with a clear message when an API call the step
 * depends on did not succeed, naming the endpoint, the status, and the
 * response body — rather than letting Playwright's default no-throw-on-4xx/5xx
 * behavior for `page.request` let a dependent step run against unconfirmed
 * setup.
 */
async function assertRequestOk(response: APIResponse, endpoint: string): Promise<void> {
  if (response.ok()) return;
  const body = await response.text().catch(() => "<response body unreadable>");
  throw new Error(
    `${endpoint} responded ${response.status()} ${response.statusText()}: ${body}`,
  );
}

/**
 * Precondition (not a run trigger): the project carries the provider row whose
 * key signs the call, filled from the environment credentials.
 */
async function ensureProviderKey(
  page: Page,
  { provider, customKeys }: { provider: string; customKeys: Record<string, string> },
) {
  const projectSlug = await getProjectSlug(page);
  // getProjectSlug reads organization.getAll; we still need the project id for
  // the tenant anchor, which the same payload carries.
  const getAllEndpoint = "/api/trpc/organization.getAll";
  const response = await page.request.get(
    `${getAllEndpoint}?batch=1&input=` +
      encodeURIComponent(JSON.stringify({ "0": { json: {} } })),
  );
  await assertRequestOk(response, getAllEndpoint);
  const data = (await response.json().catch(() => null)) as unknown;
  const projectId = findProjectIdForSlug(data, projectSlug);

  const updateEndpoint = "/api/trpc/modelProvider.update";
  // This request body carries real provider credentials (`customKeys`).
  // Playwright's default `maxRedirects` (20) would silently re-send that
  // body — including the credentials — to wherever a 3xx pointed, before
  // `assertRequestOk` below ever gets a chance to inspect the response.
  // `maxRedirects: 0` refuses to follow any redirect, so one surfaces as a
  // request-shape bug to fix, never as a credential leak to a second origin.
  const updateResponse = await page.request.post(`${updateEndpoint}?batch=1`, {
    data: {
      "0": {
        json: { projectId, provider, enabled: true, customKeys },
      },
    },
    maxRedirects: 0,
  });
  await assertRequestOk(updateResponse, updateEndpoint);
}

type OrgGetAll = {
  "0"?: {
    result?: {
      data?: {
        json?: Array<{
          teams?: Array<{ projects?: Array<{ id?: string; slug?: string }> }>;
        }>;
      };
    };
  };
};

/**
 * Resolves the project id for the pinned/derived slug from an
 * `organization.getAll` payload.
 *
 * No fallback to "the first project" when the slug is not found: writing a
 * provider credential requires a positively-identified project, and a
 * fallback here would let real credentials land in an unrelated one. A slug
 * that does not match throws instead, naming the slug and every slug that
 * was actually available.
 */
function findProjectIdForSlug(data: unknown, slug: string): string {
  const orgs = (data as OrgGetAll)?.["0"]?.result?.data?.json ?? [];
  const availableSlugs: string[] = [];
  for (const org of orgs) {
    for (const team of org.teams ?? []) {
      for (const project of team.projects ?? []) {
        if (project.slug) availableSlugs.push(project.slug);
        if (project.slug === slug && project.id) return project.id;
      }
    }
  }
  throw new Error(
    `No project found for slug "${slug}" (available slugs: ${
      availableSlugs.length > 0 ? availableSlugs.join(", ") : "<none>"
    })`,
  );
}

/** Given the project has the Twilio credentials that let it place a call. */
export async function givenTheProjectHasTwilio(page: Page, creds: PhoneCreds) {
  await ensureProviderKey(page, {
    provider: "twilio",
    customKeys: {
      TWILIO_ACCOUNT_SID: creds.accountSid,
      TWILIO_AUTH_TOKEN: creds.authToken,
      TWILIO_FROM_NUMBER: creds.fromNumber,
    },
  });
}

/** Given the project has the ElevenLabs credential that signs a session. */
export async function givenTheProjectHasElevenLabs(
  page: Page,
  creds: ElevenLabsCreds,
) {
  await ensureProviderKey(page, {
    provider: "elevenlabs",
    customKeys: { ELEVENLABS_API_KEY: creds.apiKey },
  });
}
