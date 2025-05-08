import React from "react";

export const WizardContext = React.createContext<{
  isInsideWizard: boolean;
}>({
  isInsideWizard: false,
});

export const WizardProvider = ({
  isInsideWizard,
  children,
}: {
  isInsideWizard: boolean;
  children: React.ReactNode;
}) => {
  return (
    <WizardContext.Provider value={{ isInsideWizard: isInsideWizard }}>
      {children}
    </WizardContext.Provider>
  );
};

export const useWizardContext = () => {
  return React.useContext(WizardContext);
};
