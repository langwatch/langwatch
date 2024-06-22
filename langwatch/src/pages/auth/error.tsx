import { type Session } from "next-auth";
import { useEffect } from "react";
import { env } from "../../env.mjs";

export default function Error({ session }: { session: Session | null }) {
  const isAuth0 = env.NEXT_PUBLIC_AUTH_PROVIDER === "auth0";

  useEffect(() => {
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      if (isAuth0) {
        const fromReferrer = !!document.referrer;
        if (fromReferrer) {
          // @ts-ignore
          window.location = document.referrer;
        } else {
          // @ts-ignore
          window.location = "/";
        }
      } else {
        // @ts-ignore
        window.location = "/auth/signin";
      }
    }
  }, [isAuth0, session]);

  return (
    <div style={{ padding: "12px" }}>
      Auth Error: Redirecting back to Sign in... Click <a href="/">here</a> if
      you are not redirected within 5 seconds.
    </div>
  );
}
