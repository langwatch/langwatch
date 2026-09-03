/**
 * The sign-up ceremony, over the process's tRPC transport.
 *
 *   initializeOrganization: the first organization, its first team, and — for
 *                           every intent but the coding-agent one — its first
 *                           project.
 *   setIntegrationMethod:   the flavour the second onboarding screen asks for.
 *
 * This lives beside `organization.createAndAssign` because it IS that
 * procedure plus its follow-ups: the same `signUpDataSchema` the process
 * supplies, the same `BEFORE_MEMBERSHIP` opt-out, the same
 * `ctx.app.organizations.createAndAssign` call, and the same organization and
 * team the client is handed back. Splitting the two put the whole ceremony a
 * package boundary away from the write it is built on, which is what forced
 * the app router to reach past `organization.createAndAssign` "straight to the
 * service" to avoid an import cycle. Co-located, there is no cycle to avoid.
 *
 * Four of the follow-ups are other verticals' and cross as ports: the standard
 * AI tool catalogue (Enterprise governance, which a core package may not
 * name), the signer's personal workspace, the first project, and the two
 * sign-up notifications. What stays here is the CEREMONY — which steps run for
 * which declared intent, which of them may fail without costing the user the
 * organization they just created, and what the client is told at the end.
 *
 * Three steps are deliberately non-fatal, and for one reason: the
 * organization already exists by the time they run, so a failure must not
 * unwind it. Each has its own lazy backfill — the catalogue is provisioned on
 * the first portal read, the personal workspace on the next session, and the
 * notifications are marketing traffic.
 *
 * Spec: specs/features/onboarding/intent-fork.feature.
 */
import {
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
import type { OrganizationApp } from "#app/organization.app";

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
  app: Readonly<{ organizations: OrganizationApp }>;
  session: Readonly<{ user: OnboardingTrpcSessionUser }> | null;
}>;

type OnboardingTrpcProcedures<
  TContext extends OnboardingTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's declared "no permission to check" policy, applied AFTER this
   * feature's own input parser — tRPC runs middlewares in the order they were
   * added, so a check installed before `.input()` would see no input at all.
   *
   * Both procedures run BEFORE the caller belongs to any organization, so
   * there is no scope to check and no permission they could hold. The
   * declaration is what keeps them reviewable rather than merely unchecked.
   */
  noPermission(declaration: { reason: string }): <TProcedure>(procedure: TProcedure) => TProcedure;
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

  /**
   * Gives a brand-new organization the standard AI tool catalogue, for every
   * intent: the personal portal must render tiles on its very first load
   * rather than a "no tools yet" empty state.
   *
   * A port because the catalogue is an Enterprise governance capability, which
   * a core package may not name. Non-fatal at the call site — the portal's own
   * read provisions the same set lazily.
   */
  ensureDefaultAiToolCatalog(
    ctx: OnboardingTrpcContext,
    input: Readonly<{ organizationId: string }>,
  ): Promise<unknown>;
  /**
   * Makes the signer's personal workspace in the new organization exist.
   *
   * A port, and it names the person rather than the caller on purpose: this is
   * where a coding-agent signup's usage lands, so the workspace belongs to the
   * user the id identifies, not to whoever happened to ask.
   */
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
    const { protected: procedure, noPermission } = procedures;

    /**
     * The one input built here rather than in the contract: `signUpData` is a
     * schema the process supplies, so the shape cannot be closed over until it
     * arrives. `primaryIntent` stays optional for rolling-deploy tolerance —
     * absent means NULL, the safe legacy default (ADR-038).
     */
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

    return trpc.router({
      initializeOrganization: noPermission(BEFORE_MEMBERSHIP)(
        procedure.input(initializeOrganizationInputSchema),
      ).mutation(async ({ input, ctx }) => {
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

          // Coding-agent signups get their personal workspace here rather than
          // on the first CLI login. That is where their usage lands, so
          // provisioning it now is what makes the page the track ends on show
          // something instead of an empty shell whose contents depend on a
          // command the user has not run yet.
          //
          // Non-fatal, matching `organization.acceptInvite`: a failure must not
          // cost the user the organization they just created, and the lazy
          // backfill recovers on their next session.
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

      /**
       * Records the flavour the customer picked.
       *
       * Separate from `initializeOrganization` because the organization is
       * created BEFORE the flavour screen is shown.
       */
      setIntegrationMethod: noPermission(BEFORE_MEMBERSHIP)(
        procedure.input(z.object({ integrationMethod: onboardingIntegrationMethodSchema })),
      ).mutation(({ input, ctx }) => {
        ports.recordIntegrationMethod({
          userId: sessionUser(ctx).id,
          selection: input.integrationMethod,
        });

        return { success: true };
      }),
    });
  }
}
