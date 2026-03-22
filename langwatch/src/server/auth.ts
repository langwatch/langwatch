import { PrismaAdapter } from "@next-auth/prisma-adapter";
import type { Account, Organization } from "@prisma/client";
import { compare } from "bcrypt";
import type { GetServerSidePropsContext, NextApiRequest } from "next";
import type { NextRequest } from "next/server";
import {
  type DefaultSession,
  getServerSession,
  type Account as NextAuthAccount,
  type NextAuthOptions,
  type User,
} from "next-auth";
import Auth0Provider, { type Auth0Profile } from "next-auth/providers/auth0";
import AzureADProvider from "next-auth/providers/azure-ad";
import CognitoProvider, {
  type CognitoProfile,
} from "next-auth/providers/cognito";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import GitlabProvider from "next-auth/providers/gitlab";
import GoogleProvider from "next-auth/providers/google";
import OktaProvider from "next-auth/providers/okta";
import { env } from "~/env.mjs";
import { prisma } from "~/server/db";
import { dependencies } from "../injection/dependencies.server";
import { getNextAuthSessionToken } from "../utils/auth";
import { createLogger } from "../utils/logger/server";
import { fireActivityTrackingNurturing } from "../../ee/billing/nurturing/hooks/activityTracking";

const logger = createLogger("langwatch:auth");

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
  interface Session extends DefaultSession {
    user: DefaultSession["user"] & {
      id: string;
    };
  }
}

/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * @see https://next-auth.js.org/configuration/options
 */
export const authOptions = (
  req: NextApiRequest | GetServerSidePropsContext["req"] | NextRequest,
): NextAuthOptions => ({
  session: {
    strategy: env.NEXTAUTH_PROVIDER === "email" ? "jwt" : "database",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  callbacks: {
    session: async ({ session, user }) => {
      if (dependencies.sessionHandler) {
        const newSession = await dependencies.sessionHandler({
          req,
          session,
          user,
        });
        if (newSession) return newSession;
      }

      if (!user && session.user.email && env.NEXTAUTH_PROVIDER === "email") {
        const user_ = await prisma.user.findUnique({
          where: {
            email: session.user.email,
          },
        });

        if (!user_) {
          throw new Error("User not found");
        }

        fireActivityTrackingNurturing({ userId: user_.id });

        return {
          ...session,
          user: {
            ...session.user,
            id: user_.id,
            email: user_.email,
          },
        };
      }

      fireActivityTrackingNurturing({ userId: user.id });

      return {
        ...session,
        user: {
          ...session.user,
          id: user.id,
          email: user.email,
        },
      };
    },
    signIn: async ({ user, account }) => {
      if (!user.email) {
        logger.error({ user }, "SignIn failed: No email provided");
        return false;
      }

      const existingUser = await prisma.user.findUnique({
        where: { email: user.email },
      });

      if (existingUser?.deactivatedAt) {
        return false;
      }

      const domain = user.email.split("@")[1];
      const orgWithSsoDomain = await prisma.organization.findFirst({
        where: {
          ssoDomain: domain,
        },
      });

      // User hasn't migrated to SSO yet — let them in with old method
      // so they can link SSO from the authentication settings page
      if (existingUser?.pendingSsoSetup) {
        return true;
      }

      // SSO flow for orgs with ssoDomain configured:
      // - Existing user + correct SSO provider → auto-link account (replaces old auth method)
      // - Existing user + wrong provider → block with SSO_PROVIDER_NOT_ALLOWED
      if (existingUser && account && orgWithSsoDomain) {
        if (isSsoProviderMatch(orgWithSsoDomain, account)) {
          await linkExistingUserToOAuthProvider(existingUser, account);
          return true;
        }
        throw new Error("SSO_PROVIDER_NOT_ALLOWED");
      }

      // Block non-SSO sign-in attempts for users whose domain has SSO enforced
      if (orgWithSsoDomain && account) {
        await checkIfSsoProviderIsAllowed(orgWithSsoDomain, account);
      }

      // New user with matching SSO domain → auto-create and add to org
      if (domain && account && orgWithSsoDomain && !existingUser) {
        await createUserAndAddToOrganization(
          user,
          orgWithSsoDomain,
          account as Account,
        );

        return true;
      }

      const sessionToken = getNextAuthSessionToken(req as any);
      if (!sessionToken) return true;

      const dbSession = await prisma.session.findUnique({
        where: { sessionToken },
      });
      const dbUser = await prisma.user.findUnique({
        where: { id: dbSession?.userId },
      });

      if (dbUser && dbUser?.email !== user.email) {
        throw new Error("DIFFERENT_EMAIL_NOT_ALLOWED");
      }

      return true;
    },
  },
  adapter: PrismaAdapter(prisma),
  providers: [
    env.NEXTAUTH_PROVIDER === "auth0"
      ? Auth0Provider({
          clientId: env.AUTH0_CLIENT_ID ?? "",
          clientSecret: env.AUTH0_CLIENT_SECRET ?? "",
          issuer: env.AUTH0_ISSUER ?? "",
          authorization: { params: { prompt: "login" } },
          profile(profile: Auth0Profile) {
            return {
              id: profile.sub,
              name: (profile.name as string) ?? profile.nickname,
              email: profile.email,
              image: profile.picture,
            };
          },
        })
      : env.NEXTAUTH_PROVIDER === "azure-ad"
        ? AzureADProvider({
            clientId: env.AZURE_AD_CLIENT_ID ?? "",
            clientSecret: env.AZURE_AD_CLIENT_SECRET ?? "",
            tenantId: env.AZURE_AD_TENANT_ID ?? "",
            authorization: {
              params: {
                prompt: "login",
                scope: "openid email profile User.Read",
              },
            },
            profile(profile) {
              return {
                id: profile.sub ?? profile.oid ?? profile.id,
                name: profile.name ?? profile.displayName,
                email:
                  profile.email ?? profile.mail ?? profile.userPrincipalName,
                image: null, // Microsoft Graph doesn't return image by default
              };
            },
          })
        : env.NEXTAUTH_PROVIDER === "cognito"
          ? CognitoProvider({
              clientId: env.COGNITO_CLIENT_ID ?? "",
              clientSecret: env.COGNITO_CLIENT_SECRET ?? "",
              issuer: env.COGNITO_ISSUER ?? "",
              client: {
                token_endpoint_auth_method: "none",
              },

              profile(profile: CognitoProfile) {
                return {
                  id: profile.sub,
                  name: profile.name,
                  email: profile.email,
                  image: profile.picture,
                };
              },
            })
          : env.NEXTAUTH_PROVIDER === "github"
            ? GitHubProvider({
                clientId: env.GITHUB_CLIENT_ID ?? "",
                clientSecret: env.GITHUB_CLIENT_SECRET ?? "",
                profile(profile) {
                  return {
                    id: profile.id.toString(),
                    name: profile.name ?? profile.login,
                    email: profile.email,
                    image: profile.avatar_url,
                  };
                },
              })
            : env.NEXTAUTH_PROVIDER === "gitlab"
              ? GitlabProvider({
                  clientId: env.GITLAB_CLIENT_ID ?? "",
                  clientSecret: env.GITLAB_CLIENT_SECRET ?? "",
                  profile(profile) {
                    return {
                      id: profile.sub?.toString(),
                      name: profile.name ?? profile.username,
                      email: profile.email,
                      image: profile.avatar_url,
                    };
                  },
                })
              : env.NEXTAUTH_PROVIDER === "google"
                ? GoogleProvider({
                    clientId: env.GOOGLE_CLIENT_ID ?? "",
                    clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
                    profile(profile) {
                      return {
                        id: profile.sub,
                        name: profile.name,
                        email: profile.email,
                        image: profile.picture,
                      };
                    },
                  })
                : env.NEXTAUTH_PROVIDER === "okta"
                  ? OktaProvider({
                      clientId: env.OKTA_CLIENT_ID ?? "",
                      clientSecret: env.OKTA_CLIENT_SECRET ?? "",
                      issuer: env.OKTA_ISSUER ?? "",
                      profile(profile) {
                        return {
                          id: profile.sub,
                          name: profile.name,
                          email: profile.email,
                          image: profile.image,
                        };
                      },
                    })
                  : CredentialsProvider({
                      name: "Credentials",
                      credentials: {
                        email: {},
                        password: {},
                      },
                      async authorize(credentials, _req) {
                        const user = await prisma.user.findUnique({
                          where: {
                            email: credentials?.email,
                          },
                        });
                        if (!user?.password) return null;
                        const passwordMatch = await compare(
                          credentials?.password ?? "",
                          user.password,
                        );
                        if (!passwordMatch) return null;

                        return {
                          id: user.id,
                          name: user.name,
                          email: user.email,
                          image: user.image,
                        };
                      },
                    }),
    /**
     * ...add more providers here.
     *
     * Most other providers require a bit more work than the Discord provider. For example, the
     * GitHub provider requires you to add the `refresh_token_expires_in` field to the Account
     * model. Refer to the NextAuth.js docs for the provider you want to use. Example:
     *
     * @see https://next-auth.js.org/providers/github
     */
  ],
  pages: {
    error: "/auth/error",
    signIn: "/auth/signin",
  },
});

const createUserAndAddToOrganization = async (
  user: User,
  organization: Organization,
  account: Account,
) => {
  const newUser = await prisma.user.create({
    data: {
      email: user.email,
      name: user.name,
      image: user.image,
    },
  });

  await prisma.account.create({
    data: {
      userId: newUser.id,
      type: account.type ?? "oauth",
      provider: account.provider,
      providerAccountId: account.providerAccountId,
      access_token: account.access_token,
      refresh_token: account.refresh_token,
      expires_at: account.expires_at,
      token_type: account.token_type,
      scope: account.scope,
      id_token: account.id_token,
    },
  });

  await prisma.organizationUser.create({
    data: {
      userId: newUser.id,
      organizationId: organization.id,
      role: "MEMBER",
    },
  });

  return newUser;
};

/**
 * Links (or re-links) an existing user to their SSO OAuth account.
 * Uses upsert so it's idempotent: first login creates the link,
 * subsequent logins just refresh tokens. Old auth methods for the
 * same provider are removed in the same transaction.
 */
const linkExistingUserToOAuthProvider = async (
  existingUser: User,
  account: NextAuthAccount,
) => {
  const accountData = {
    userId: existingUser.id,
    type: account.type ?? "oauth",
    provider: account.provider,
    providerAccountId: account.providerAccountId,
    access_token: account.access_token,
    refresh_token: account.refresh_token,
    expires_at: account.expires_at,
    token_type: account.token_type,
    scope: account.scope,
    id_token: account.id_token,
  };

  await prisma.$transaction([
    prisma.account.upsert({
      where: {
        provider_providerAccountId: {
          provider: account.provider,
          providerAccountId: account.providerAccountId,
        },
      },
      create: accountData,
      update: {
        access_token: account.access_token,
        refresh_token: account.refresh_token,
        expires_at: account.expires_at,
        token_type: account.token_type,
        scope: account.scope,
        id_token: account.id_token,
      },
    }),
    prisma.account.deleteMany({
      where: {
        userId: existingUser.id,
        provider: account.provider,
        providerAccountId: { not: account.providerAccountId },
      },
    }),
    prisma.user.update({
      where: { id: existingUser.id },
      data: { pendingSsoSetup: false },
    }),
  ]);
};

/**
 * Checks if the incoming account matches the org's configured SSO provider.
 * For Auth0: matches via providerAccountId prefix (e.g. "waad|connection-name")
 * For direct NextAuth providers: matches via provider name (e.g. "google", "okta")
 */
const isSsoProviderMatch = (
  org: Organization,
  account: NextAuthAccount,
): boolean => {
  if (!org.ssoProvider) return false;
  return (
    account.providerAccountId.startsWith(org.ssoProvider) ||
    account.provider === org.ssoProvider
  );
};

const checkIfSsoProviderIsAllowed = async (
  org: Organization,
  provider: NextAuthAccount,
) => {
  if (org?.ssoProvider && !isSsoProviderMatch(org, provider)) {
    throw new Error("SSO_PROVIDER_NOT_ALLOWED");
  }

  return true;
};
/**
 * Wrapper for `getServerSession` so that you don't need to import the `authOptions` in every file.
 *
 * @see https://next-auth.js.org/configuration/nextjs
 */
export const getServerAuthSession = (ctx: {
  req: GetServerSidePropsContext["req"];
  res: GetServerSidePropsContext["res"];
}) => {
  return getServerSession(ctx.req, ctx.res, authOptions(ctx.req));
};
