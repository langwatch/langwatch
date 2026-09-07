/**
 * The sign-up ceremony over tRPC. Lives beside `organization.createAndAssign` to avoid the
 * import cycle a package boundary would force. Cross-vertical follow-ups arrive as ports; three
 * are deliberately non-fatal, each with its own lazy backfill instead of unwinding the org.
 */
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import {
  onboardingWriteAckSchema,
  organizationInitializedSchema,
  organizationIntentSchema,
  type OrganizationIntent,
} from "@langwatch/organization-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";
import type { OrganizationApi } from "@langwatch/organization-contract";

/**
 * The four keys the "pick your flavour" screen offers. The trait values they
 * map to are the process's — they are a marketing vocabulary, not this
 * feature's — so only the keys are named here.
 */
export const onboardingIntegrationMethodSchema = z.enum([
  "via-claude-code",
  "via-platform",
  "via-claude-desktop",
  "manually",
]);

/** One of the four selections above. */
export type OnboardingIntegrationMethod = z.infer<typeof onboardingIntegrationMethodSchema>;

/** The authenticated principal, as the process's session carries it. */
type OnboardingTrpcSessionUser = Readonly<{
  id: string;
  name?: string | null;
  email?: string | null;
}>;

/** The process supplies authentication; authorization arrives as `noPermission`. */
export type OnboardingTrpcContext = Readonly<{
  app: Readonly<{ organizations: OrganizationApi }>;
  session: Readonly<{ user: OnboardingTrpcSessionUser }> | null;
}>;

type OnboardingTrpcProcedures<
  TContext extends OnboardingTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /** The process's declared "no permission to check" policy — both procedures run before the
   * caller belongs to any organization, so the declaration keeps them reviewable, not unchecked. */
  noPermission(declaration: { reason: string }): <TProcedure>(procedure: TProcedure) => TProcedure;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
}>;

/** What the two sign-up notifications carry. */
type SignupNotification = Readonly<{
  userName?: string | null;
  userEmail?: string | null;
  organizationName: string;
  phoneNumber?: string;
  /**
   * The answers to the process's own sign-up questionnaire, forwarded
   * untouched. Opaque because the schema is the process's — see
   * `signUpDataSchema` below.
   */
  signUpData?: unknown;
}>;

// ---------------------------------------------------------------------------
// The process capabilities this ceremony needs that are not the
// organization's own
// ---------------------------------------------------------------------------

export type OnboardingTrpcPorts<TSignUpDataSchema extends z.ZodTypeAny = z.ZodTypeAny> = Readonly<{
  /**
   * The sign-up questionnaire's schema, the same one `organization.*` is
   * given. The process owns it because the acquisition-attribution fields it
   * carries are captured in the browser.
   */
  signUpDataSchema: TSignUpDataSchema;

  /** Gives a brand-new organization the standard AI tool catalogue. A port since it's an
   * Enterprise governance capability; non-fatal, since the portal's own read provisions lazily. */
  ensureDefaultAiToolCatalog(
    ctx: OnboardingTrpcContext,
    input: Readonly<{ organizationId: string }>,
  ): Promise<unknown>;
  /** Makes the signer's personal workspace exist. Names the person, not the caller, since this
   * is where a coding-agent signup's usage lands. */
  ensurePersonalWorkspace(
    ctx: OnboardingTrpcContext,
    input: Readonly<{
      userId: string;
      organizationId: string;
      displayName?: string | null;
      displayEmail?: string | null;
    }>,
  ): Promise<unknown>;
  /**
   * The organization's first project, created through the process's own
   * project surface so it runs that surface's authorization, audit and
   * provisioning rather than a second copy of them.
   */
  createProject(
    ctx: OnboardingTrpcContext,
    input: Readonly<{
      organizationId: string;
      teamId: string;
      name: string;
      language: string;
      framework: string;
    }>,
  ): Promise<Readonly<{ success: boolean; projectSlug: string }>>;
  /** Tells the team a customer signed up. */
  sendSlackSignupEvent(ctx: OnboardingTrpcContext, input: SignupNotification): Promise<void>;
  /** Files the same sign-up with the marketing forms. */
  sendHubspotSignupForm(ctx: OnboardingTrpcContext, input: SignupNotification): Promise<void>;
  /**
   * Identifies the new customer to the nurturing pipeline. Fire and forget:
   * onboarding never waits on marketing.
   */
  fireSignupNurturing(
    input: Readonly<{
      userId: string;
      email?: string | null;
      name?: string | null;
      organizationId: string;
      organizationName: string;
      signUpData?: unknown;
      /** ADR-038 org intent — an explicit trait, never part of signUpData. */
      primaryIntent?: OrganizationIntent | null;
    }>,
  ): void;
  /**
   * Records which flavour the customer picked. The process translates the
   * screen's key into its own trait vocabulary; this surface only knows which
   * key was chosen.
   */
  recordIntegrationMethod(
    input: Readonly<{ userId: string; selection: OnboardingIntegrationMethod }>,
  ): void;
  /** Never fatal: every caller below is on a non-fatal branch. */
  reportError(
    error: unknown,
    context?: Readonly<{ extra?: Readonly<Record<string, unknown>> }>,
  ): void;
}>;

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

/**
 * The one opt-out both procedures make, and the same sentence for both: they
 * run before the caller belongs to any organization, so there is no scope to
 * check and no permission they could hold.
 */
const BEFORE_MEMBERSHIP = {
  reason: "onboarding runs before the user belongs to any organization",
} as const;

/**
 * The intent that ends on the personal portal rather than in a project.
 * ADR-038 v6: a coding-agent signup gets a personal workspace and no shared
 * project; the organization creates one when it later flips to LLMOps.
 */
const CODING_AGENT_INTENT = "AGENT_GOVERNANCE";

/**
 * The signed-in user, proven present. `protectedProcedure` has already refused
 * an anonymous caller, so this only narrows the type.
 */
function sessionUser(ctx: OnboardingTrpcContext): OnboardingTrpcSessionUser {
  const user = ctx.session?.user;
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return user;
}

/** Installs the `onboarding.*` tRPC surface on a process-owned root. */
export class OnboardingTrpcApi {
  static create<
    TContext extends OnboardingTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TSignUpDataSchema extends z.ZodTypeAny,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: OnboardingTrpcProcedures<TContext, TOptions, TRoot>,
    ports: OnboardingTrpcPorts<TSignUpDataSchema>,
  ) {
    const { protected: procedure, noPermission, validateOutput } = procedures;

    /** The one input built here rather than the contract, since `signUpData`'s schema arrives
     * from the process. `primaryIntent` stays optional for rolling-deploy tolerance (ADR-038). */
    const initializeOrganizationInputSchema = z.object({
      // Organization details
      orgName: z.string().optional(),
      phoneNumber: z.string().optional(),
      signUpData: ports.signUpDataSchema.optional(),
      primaryIntent: organizationIntentSchema.optional(),

      // Project details
      projectName: z.string().optional(),
      language: z.string().default("other"),
      framework: z.string().default("other"),
    });

    /** Neither procedure holds a permission, so the chain's own `policy` builder is never
     * called — `withCustomPermission` carries the process's already-built decorator instead. */
    const policy = (): TrpcPolicyDecorator => {
      throw new Error("onboarding declares no-permission for every procedure; policy() is unused");
    };

    return (
      createTrpcService({
        root: trpc,
        procedures: { protected: procedure, policy },
        validateOutput,
      })
        .mutation("initializeOrganization", (p) =>
          p
            .withInput(initializeOrganizationInputSchema)
            .withOutput(organizationInitializedSchema)
            .withCustomPermission(noPermission(BEFORE_MEMBERSHIP), BEFORE_MEMBERSHIP.reason)
            .handle(async ({ input, ctx }) => {
              const user = sessionUser(ctx);
              // Opaque all the way through: the questionnaire's shape is the
              // process's, and every consumer of it below is a port back into the
              // process.
              const signUpData = input.signUpData as unknown as Record<string, unknown> | undefined;

              try {
                const orgResult = await ctx.app.organizations.createAndAssign(
                  {
                    orgName: input.orgName,
                    phoneNumber: input.phoneNumber,
                    signUpData,
                    primaryIntent: input.primaryIntent,
                    userDisplayName: user.name,
                  },
                  { id: user.id },
                );

                // Every new organization gets the standard catalogue at creation,
                // whatever the intent, so the portal renders tiles on its first
                // load. Non-fatal: the portal's own read provisions the same set.
                try {
                  await ports.ensureDefaultAiToolCatalog(ctx, {
                    organizationId: orgResult.organization.id,
                  });
                } catch (error) {
                  ports.reportError(error, {
                    extra: {
                      origin: "onboarding.initializeOrganization.ensureDefaultCatalog",
                      organizationId: orgResult.organization.id,
                    },
                  });
                }

                // Coding-agent signups get their personal workspace here rather than on the
                // first CLI login, so the ending page shows something rather than an empty
                // shell. Non-fatal, matching `organization.acceptInvite`: the lazy backfill
                // recovers on the next session.
                if (input.primaryIntent === CODING_AGENT_INTENT) {
                  try {
                    await ports.ensurePersonalWorkspace(ctx, {
                      userId: user.id,
                      organizationId: orgResult.organization.id,
                      displayName: user.name,
                      displayEmail: user.email,
                    });
                  } catch (error) {
                    ports.reportError(error, {
                      extra: {
                        origin: "onboarding.initializeOrganization",
                        organizationId: orgResult.organization.id,
                      },
                    });
                  }
                }

                // The first project, skipped for the coding-agent track (ADR-038
                // v6): those users live on the personal portal, and a project is
                // created only when the organization later flips to LLMOps.
                let projectSlug: string | null = null;
                if (input.primaryIntent !== CODING_AGENT_INTENT) {
                  const projectResult = await ports.createProject(ctx, {
                    organizationId: orgResult.organization.id,
                    teamId: orgResult.team.id,
                    // The organization's own team names the project when the
                    // customer did not name one: at this point in the ceremony it is
                    // the only name they have given us.
                    name: input.projectName ?? orgResult.team.name,
                    language: input.language,
                    framework: input.framework,
                  });
                  if (!projectResult.success) {
                    throw new TRPCError({
                      code: "INTERNAL_SERVER_ERROR",
                      message: "Failed to create project",
                    });
                  }
                  projectSlug = projectResult.projectSlug;
                }

                try {
                  const signupPayload = {
                    userName: user.name,
                    userEmail: user.email,
                    organizationName: orgResult.organization.name,
                    phoneNumber: input.phoneNumber,
                    signUpData,
                  };

                  await Promise.all([
                    ports.sendSlackSignupEvent(ctx, signupPayload),
                    ports.sendHubspotSignupForm(ctx, signupPayload),
                  ]);
                } catch (error) {
                  ports.reportError(error);
                }

                ports.fireSignupNurturing({
                  userId: user.id,
                  email: user.email,
                  name: user.name,
                  organizationId: orgResult.organization.id,
                  organizationName: orgResult.organization.name,
                  signUpData,
                  primaryIntent: input.primaryIntent,
                });

                // `projectSlug` is null for the coding-agent track, which is how the
                // client knows to land on the personal portal instead of a project.
                return {
                  success: true,
                  teamSlug: orgResult.team.slug,
                  teamName: orgResult.team.name,
                  teamId: orgResult.team.id,
                  organizationId: orgResult.organization.id,
                  projectSlug,
                };
              } catch (error) {
                ports.reportError(error);
                throw error;
              }
            }),
        )
        /** Records the flavour the customer picked, separate from `initializeOrganization`
         * since the organization is created before the flavour screen is shown. */
        .mutation("setIntegrationMethod", (p) =>
          p
            .withInput(z.object({ integrationMethod: onboardingIntegrationMethodSchema }))
            .withOutput(onboardingWriteAckSchema)
            .withCustomPermission(noPermission(BEFORE_MEMBERSHIP), BEFORE_MEMBERSHIP.reason)
            .handle(({ input, ctx }) => {
              ports.recordIntegrationMethod({
                userId: sessionUser(ctx).id,
                selection: input.integrationMethod,
              });

              return { success: true };
            }),
        )
        .build()
    );
  }
}
