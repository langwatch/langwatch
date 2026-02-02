import { useRouter } from "next/router";
import { useSession } from "next-auth/react";

export const publicRoutes = ["/share/[id]", "/auth/signin", "/auth/signup", "/auth/error"];

// Auth routes should not trigger redirect loops
const authRoutes = ["/auth/signin", "/auth/signup", "/auth/error"];

export const useRequiredSession = (
  { required = true }: { required?: boolean } = { required: true },
) => {
  const router = useRouter();

  const session = useSession({
    required,
    onUnauthenticated: required
      ? () => {
          if (publicRoutes.includes(router.route)) return;
          // Don't redirect on auth pages - prevents infinite loop
          if (authRoutes.includes(router.route)) return;
          if (navigator.onLine) {
            // Redirect to signin page instead of hardcoding auth0
            void router.push("/auth/signin");
          } else {
            window.addEventListener("online", () => window.location.reload());
          }
        }
      : undefined,
  });

  return session;
};
