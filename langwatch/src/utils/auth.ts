import type { GetServerSidePropsContext, NextApiRequest } from "next";
import type { NextRequest } from "next/server";

export const getNextAuthSessionToken = (
  req: NextApiRequest | GetServerSidePropsContext["req"] | NextRequest
) => {
  if (typeof req.cookies.get === "function") {
    return (
      req.cookies.get("next-auth.session-token")?.value ??
      req.cookies.get("__Secure-next-auth.session-token")?.value
    );
  }

  return (
    //@ts-ignore
    req.cookies["next-auth.session-token"] ??
    //@ts-ignore
    req.cookies["__Secure-next-auth.session-token"]
  );
};
