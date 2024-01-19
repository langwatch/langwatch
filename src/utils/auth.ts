import type { GetServerSidePropsContext, NextApiRequest } from "next";

export const isAdmin = (user: { email?: string | null }) => {
  const adminEmails = process.env.ADMIN_EMAILS;
  return (
    adminEmails && user.email && adminEmails.split(",").includes(user.email)
  );
};

export const getNextAuthSessionToken = (
  req: NextApiRequest | GetServerSidePropsContext["req"]
) => {
  return (
    req.cookies["next-auth.session-token"] ??
    req.cookies["__Secure-next-auth.session-token"]
  );
};
