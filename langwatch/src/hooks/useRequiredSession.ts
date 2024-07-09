import { signIn, useSession } from "next-auth/react";

export const useRequiredSession = (
  {
    required = true,
  }: {
    required?: boolean;
  } = { required: true }
) => {
  const session = useSession({
    required,
    onUnauthenticated: required
      ? () => {
          if (navigator.onLine) {
            void signIn("auth0");
          } else {
            window.addEventListener("online", () => window.location.reload());
          }
        }
      : undefined,
  });

  return session;
};
