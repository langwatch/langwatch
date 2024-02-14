import React, { createContext, useContext, useState } from "react";

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

export const DevViewProvider = ({ children }) => {
  const [isDevViewEnabled, setIsDevViewEnabled] = useState(false);

  const toggleDevView = () => {
    setIsDevViewEnabled((prev) => !prev);
  };

  return (
    <DevViewContext.Provider value={{ isDevViewEnabled, toggleDevView }}>
      {children}
    </DevViewContext.Provider>
  );
};
