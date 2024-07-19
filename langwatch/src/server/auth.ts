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
