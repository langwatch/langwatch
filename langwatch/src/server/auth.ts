import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { type GetServerSidePropsContext, type NextApiRequest } from "next";
import {
  getServerSession,
  type DefaultSession,
  type NextAuthOptions,
} from "next-auth";
import Auth0Provider, { type Auth0Profile } from "next-auth/providers/auth0";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcrypt";

import { env } from "~/env.mjs";
import { prisma } from "~/server/db";
import { dependencies } from "../injection/dependencies.server";
import type { NextRequest } from "next/server";
import { getNextAuthSessionToken } from "../utils/auth";
import AzureADProvider from "next-auth/providers/azure-ad";
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
  req: NextApiRequest | GetServerSidePropsContext["req"] | NextRequest
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

        return {
          ...session,
          user: {
            ...session.user,
            id: user_.id,
            email: user_.email,
          },
        };
      }

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
      if (!user.email) return false;

      const existingUser = await prisma.user.findUnique({
        where: { email: user.email },
      });

      if (existingUser?.pendingSsoSetup && account?.provider) {
        // Wrap operations in a transaction
        await prisma.$transaction([
          // Create the account link first
          prisma.account.create({
            data: {
              userId: existingUser.id,
              type: account.type ?? "oauth",
              provider: account.provider,
              providerAccountId: user.id,
              access_token: account.access_token,
              refresh_token: account.refresh_token,
              expires_at: account.expires_at,
              token_type: account.token_type,
              scope: account.scope,
              id_token: account.id_token,
            },
          }),

          // Delete old accounts with the same provider (except the one we just created)
          prisma.account.deleteMany({
            where: {
              userId: existingUser.id,
              provider: account.provider,
              providerAccountId: { not: user.id },
            },
          }),
          prisma.user.update({
            where: { id: existingUser.id },
            data: { pendingSsoSetup: false },
          }),
        ]);

        return true;
      } else {
        const sessionToken = getNextAuthSessionToken(req as any);
        if (!sessionToken) return true;

        const dbSession = await prisma.session.findUnique({
          where: { sessionToken },
        });
        const dbUser = await prisma.user.findUnique({
          where: { id: dbSession?.userId },
        });

        if (dbUser?.email !== user.email) {
          throw new Error("DIFFERENT_EMAIL_NOT_ALLOWED");
        }
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
          clientId: env.AZURE_CLIENT_ID ?? "",
          clientSecret: env.AZURE_CLIENT_SECRET ?? "",
          tenantId: env.AZURE_TENANT_ID ?? "",
          authorization: {
            params: { prompt: "login", scope: "openid email profile" },
          },
          profile(profile) {
            return {
              id: profile.sub ?? profile.id,
              name: profile.displayName,
              email: profile.mail ?? profile.userPrincipalName,
              image: null, // Microsoft Graph doesn't return image by default
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
              user.password
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
