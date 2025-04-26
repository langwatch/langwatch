import React from "react";

export const WorkflowStoreContext = React.createContext<{
  useWorkflowStoreFromWizard: boolean;
}>({
  useWorkflowStoreFromWizard: false,
});

export const WorkflowStoreProvider = ({
  useWorkflowStoreFromWizard,
  children,
}: {
  useWorkflowStoreFromWizard: boolean;
  children: React.ReactNode;
}) => {
  return (
    <WorkflowStoreContext.Provider
      value={{ useWorkflowStoreFromWizard: useWorkflowStoreFromWizard }}
    >
      {children}
    </WorkflowStoreContext.Provider>
  );
};
