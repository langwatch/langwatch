import { useRouter } from "next/router";
import type { PropsWithChildren } from "react";
import React, { createContext, useContext, useState, useEffect } from "react";

interface DevViewContextType {
  isDevViewEnabled: boolean;
  toggleDevView: () => void;
}

const DevViewContext = createContext<DevViewContextType | undefined>(undefined);

export const useDevView = (): DevViewContextType => {
  const context = useContext(DevViewContext);
  if (!context) {
    throw new Error("useDevView must be used within a DevViewProvider");
  }
  return context;
};

export const DevViewProvider = ({ children }: PropsWithChildren) => {
  const [isDevViewEnabled, setIsDevViewEnabled] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const modeQueryParam = router.query.mode as string;
    setIsDevViewEnabled(modeQueryParam === "dev");
  }, [router.query.mode]);

  const toggleDevView = () => {
    setIsDevViewEnabled((prev) => !prev);
    const mode = !isDevViewEnabled ? "dev" : "";

    void router.replace({ query: { ...router.query, mode } });
  };

  return (
    <DevViewContext.Provider value={{ isDevViewEnabled, toggleDevView }}>
      {children}
    </DevViewContext.Provider>
  );
};
