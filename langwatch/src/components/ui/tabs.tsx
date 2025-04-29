import { Tabs as ChakraTabs } from "@chakra-ui/react";
import { type ReactNode } from "react";

interface ValueChangeDetails {
  value: string;
}

interface TabsRootProps {
  value?: string;
  onValueChange?: (details: ValueChangeDetails) => void;
  children: ReactNode;
}

interface CustomTabsTriggerProps {
  value: string;
  children: ReactNode;
}

interface TabsContentProps {
  value: string;
  children: ReactNode;
}

export const Tabs = {
  Root: ({ value, onValueChange, children, ...props }: TabsRootProps) => (
    <ChakraTabs.Root value={value} onValueChange={onValueChange} {...props}>
      {children}
    </ChakraTabs.Root>
  ),
  List: ({ children, ...props }: { children: ReactNode }) => (
    <ChakraTabs.List {...props}>{children}</ChakraTabs.List>
  ),
  Trigger: ({ value, children, ...props }: CustomTabsTriggerProps) => (
    <ChakraTabs.Trigger value={value} {...props}>
      {children}
    </ChakraTabs.Trigger>
  ),
  Content: ({ value, children, ...props }: TabsContentProps) => (
    <ChakraTabs.Content value={value} {...props}>
      {children}
    </ChakraTabs.Content>
  ),
};
