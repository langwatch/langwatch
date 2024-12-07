import { api } from "../utils/api";

export const usePublicEnv = () => {
  return api.publicEnv.useQuery(
    {},
    {
      staleTime: Infinity,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    }
  );
};
