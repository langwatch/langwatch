import type { GetServerSidePropsContext, NextApiRequest } from "next";
import { NextRequest } from "next/server";

export const isAdmin = (user: { email?: string | null }) => {
  const adminEmails = process.env.ADMIN_EMAILS;
  return (
    adminEmails && user.email && adminEmails.split(",").includes(user.email)
  );
};

export const getNextAuthSessionToken = (
  req: NextApiRequest | GetServerSidePropsContext["req"] | NextRequest
) => {
  if (req instanceof NextRequest) {
    return (
      req.cookies.get("next-auth.session-token")?.value ??
      req.cookies.get("__Secure-next-auth.session-token")?.value
    );
  }

  return (
    req.cookies["next-auth.session-token"] ??
    req.cookies["__Secure-next-auth.session-token"]
  );
};
