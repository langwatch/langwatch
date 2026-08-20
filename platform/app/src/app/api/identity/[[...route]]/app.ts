/**
 * The identity REST family — RPC-named operations (D01).
 *
 * Identity's operations are ceremonies, not resources: nothing here is CRUD
 * over a collection, so the family adopts the dotted `<resource>.<verb>` RPC
 * naming (`verification.complete`) rather than inventing path nouns for
 * verbs. Every argument travels in the JSON body; every operation is a POST.
 *
 * The magic-link LANDING page (GET renders, never verifies) is deliberately
 * not here — it is a browser page, not an API operation, and lives in
 * `~/server/routes/identity-verification.ts`. Completion is this family's
 * `verification.complete`, which carries the real proofs: the emailed token
 * and the initiating context's PKCE verifier, checked by the ceremony
 * service against the id-pinned record.
 *
 * Auth is the signed-in user's session — the ceremony verifies *their* own
 * identifier, and the service re-checks the record pins exactly their
 * userId. No RBAC permission applies (identity is user-scoped, not
 * organization-scoped).
 *
 * Spec: specs/identity/identifier-model.feature.
 */
import type { BaseApp, VersionBuilder } from "@langwatch/api";
import { createService } from "@langwatch/api";
import { HandledError } from "@langwatch/handled-error";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  type AccessPolicy,
  credentialClassFor,
  handlerManagedAuth,
  publicEndpoint,
  registerRoutePolicy,
} from "~/server/api/security";
import { IdentityCeremonies } from "~/server/app-layer/identity/identity-ceremonies";
import {
  PrismaIdentityVerificationRepository,
  PrismaVerifiableIdentifierReads,
} from "~/server/app-layer/identity/repositories/identity-verification.prisma.repository";
import { VerificationCeremonyService } from "~/server/app-layer/identity/verification-ceremony";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";

export const IDENTITY_API_VERSION = "2026-08-20";

const BASE_PATH = "/api/identity";
const FAMILY = "identity";

class IdentitySessionRequiredError extends HandledError {
  constructor() {
    super("missing_credentials", "missing_credentials", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "IdentitySessionRequiredError";
  }
}

/** The signed-in user, or a 401 refusal — the whole family's credential. */
const sessionAuth: MiddlewareHandler = async (c, next) => {
  const session = await getServerAuthSession({ req: c.req.raw as never });
  const userId = session?.user?.id;
  if (!userId) throw new IdentitySessionRequiredError();
  c.set("sessionUserId", userId);
  await next();
};

const sessionUserOf = (c: Context): string => {
  const userId = c.get("sessionUserId") as string | undefined;
  if (!userId) throw new IdentitySessionRequiredError();
  return userId;
};

const familyPolicy: AccessPolicy = handlerManagedAuth({
  reason:
    "user session required by the family auth middleware; the ceremony service additionally checks token, PKCE verifier and record pinning",
  permissions: [],
  credential: "session",
});

type IdentityFamilyApp = BaseApp & {
  verification: VerificationCeremonyService;
};
type IdentityVersion = VersionBuilder<IdentityFamilyApp>;

/** Test seam: swap the composed ceremony service. */
let serviceOverride: VerificationCeremonyService | null = null;
export function setVerificationCeremoniesForTests(
  replacement: VerificationCeremonyService | null,
): void {
  serviceOverride = replacement;
}

function composeVerificationCeremonies(): VerificationCeremonyService {
  return new VerificationCeremonyService({
    store: new PrismaIdentityVerificationRepository(prisma),
    identifiers: new PrismaVerifiableIdentifierReads(prisma),
    ceremonies: new IdentityCeremonies({ prisma }),
  });
}

const completeVerificationSchema = z.object({
  identifierId: z.string().min(1),
  verificationId: z.string().min(1),
  token: z.string().min(1),
  codeVerifier: z.string().min(1),
});

const registerEndpoints = (v: IdentityVersion): void => {
  v.rpc(
    "/verification.complete",
    {
      input: completeVerificationSchema,
      output: z.object({ verified: z.literal(true) }),
      description:
        "Complete an email verification ceremony: presents the emailed single-use token together with the PKCE code verifier from the context that started the ceremony. Both proofs must match the record pinned to exactly this identifier and user; a link opened on its own can never verify anything.",
      docs: {
        operationId: "completeIdentityVerification",
        tags: ["Identity"],
      },
      meta: { policy: familyPolicy },
    },
    async (c, { input, app }) => {
      await app.verification.completeEmailVerification({
        userId: sessionUserOf(c),
        identifierId: input.identifierId,
        verificationId: input.verificationId,
        token: input.token,
        codeVerifier: input.codeVerifier,
      });
      return { verified: true as const };
    },
  );
};

export const app = createService({
  name: "identity",
  basePath: BASE_PATH,
  auth: sessionAuth,
  onRouteMounted: (route) => {
    if (route.isNamespaceGuard) {
      const policy = publicEndpoint(
        "version-namespace guard: answers 404 for unknown version segments; reads no data and takes no credential",
      );
      registerRoutePolicy({
        method: route.method,
        path: route.path,
        policy,
        family: FAMILY,
        credentialClass: credentialClassFor({ scope: "session", policy }),
      });
      return;
    }
    const policy =
      (route.config?.meta as { policy?: AccessPolicy } | undefined)?.policy ??
      familyPolicy;
    registerRoutePolicy({
      method: route.method,
      path: route.path,
      policy,
      family: FAMILY,
      credentialClass: credentialClassFor({ scope: "session", policy }),
    });
  },
})
  .provide({
    verification: () => serviceOverride ?? composeVerificationCeremonies(),
  })
  .version(IDENTITY_API_VERSION, (v) => {
    registerEndpoints(v);
  })
  .build();
