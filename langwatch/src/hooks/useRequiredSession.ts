import { signIn, useSession } from "next-auth/react";

export const useRequiredSession = () => {
  const session = useSession({
    required: true,
    onUnauthenticated: () => {
      if (navigator.onLine) {
        void signIn("auth0");
      } else {
        window.addEventListener("online", () => window.location.reload());
      }
    },
  });

  return session;
};
