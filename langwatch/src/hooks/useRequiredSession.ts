import { signIn, useSession } from "next-auth/react";

export const useRequiredSession = () => {
  return useSession({
    required: true,
    onUnauthenticated: () => void signIn("auth0"),
  });
};
