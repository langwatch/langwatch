import { prismaRepositories } from "@langwatch/prisma-client";
import { PrismaAuthSessionRepository } from "./prisma.auth-session.repository.ts";
import { PrismaSignUpVerificationTokenRepository } from "./prisma.signup-verification-token.repository.ts";

export const PostgresAuthRepositories = prismaRepositories({
  sessions: PrismaAuthSessionRepository,
  signUpTokens: PrismaSignUpVerificationTokenRepository,
});
