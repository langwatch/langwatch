import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/router";

export const publicRoutes = ["/share/[id]"];

export const useRequiredSession = (
  {
    required = true,
  }: {
    required?: boolean;
  } = { required: true }
) => {
  const router = useRouter();

  const session = useSession({
    required,
    onUnauthenticated: required
      ? () => {
          if (publicRoutes.includes(router.route)) return;
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
