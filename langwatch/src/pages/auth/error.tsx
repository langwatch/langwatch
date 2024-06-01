import { type Session } from "next-auth";
import { useEffect } from "react";

export default function Error({ session }: { session: Session | null }) {
  useEffect(() => {
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      const fromReferrer = !!document.referrer;
      if (fromReferrer) {
        // @ts-ignore
        window.location = document.referrer;
      } else {
        // @ts-ignore
        window.location = "/";
      }
    }
  }, [session]);

  return (
    <div style={{ padding: "12px" }}>
      Auth Error: Redirecting back to Sign in... Click <a href="/">here</a> if
      you are not redirected within 5 seconds.
    </div>
  );
}
