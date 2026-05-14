import { api } from "../utils/api";

export const usePublicEnv = () => {
  return api.publicEnv.useQuery(
    {},
    {
      // Server env vars don't change while the app is open — caching forever
      // is correct. Server restart gives the user a new bundle anyway.
      staleTime: Infinity,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  );
};
