import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "langwatch:traces-v2:welcome-seen";

function readSeen(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

function writeSeen() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // ignore
  }
}

export function useWelcomeSeen() {
  const [seen, setSeen] = useState<boolean>(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSeen(readSeen());
    setHydrated(true);
  }, []);

  const markSeen = useCallback(() => {
    writeSeen();
    setSeen(true);
  }, []);

  return { seen, markSeen, hydrated };
}
