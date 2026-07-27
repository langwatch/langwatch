import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { createTrpcClient, trpc } from "@/api/trpc";
import type { StoredSession } from "@/lib/session";

import { sessionStore } from "./sessionStore";

interface AuthValue {
  /** Null while restoring, then the session or `signedOut`. */
  status: "restoring" | "signedOut" | "signedIn";
  session: StoredSession | null;
  signIn: (session: StoredSession) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth used outside AuthProvider");
  return value;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthValue["status"]>("restoring");
  const [session, setSession] = useState<StoredSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    void sessionStore.current().then((restored) => {
      if (cancelled) return;
      setSession(restored);
      setStatus(restored ? "signedIn" : "signedOut");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (next: StoredSession) => {
    await sessionStore.store(next);
    setSession(next);
    setStatus("signedIn");
  }, []);

  const signOut = useCallback(async () => {
    await sessionStore.clear();
    setSession(null);
    setStatus("signedOut");
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ status, session, signIn, signOut }),
    [status, session, signIn, signOut],
  );

  return (
    <AuthContext.Provider value={value}>
      {session ? (
        <ApiProvider
          key={session.instance}
          instance={session.instance}
          onUnauthorized={signOut}
        >
          {children}
        </ApiProvider>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}

/**
 * The tRPC + react-query providers, keyed to the signed-in instance.
 *
 * Remounted when the instance changes so no cached answer from one instance can
 * ever be shown under another — the ids look alike across instances and a stale
 * queue depth attributed to the wrong platform is worse than no answer.
 */
function ApiProvider({
  instance,
  onUnauthorized,
  children,
}: {
  instance: string;
  onUnauthorized: () => void;
  children: React.ReactNode;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // A phone is often on a flaky connection; one retry smooths that
            // over without making a genuinely-down instance take half a minute
            // to say so.
            retry: 1,
            refetchOnWindowFocus: true,
            staleTime: 5_000,
          },
        },
      }),
  );

  const [client] = useState(() =>
    createTrpcClient({ instance, onUnauthorized }),
  );

  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
