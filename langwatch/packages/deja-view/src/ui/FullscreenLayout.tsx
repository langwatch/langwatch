import { Box, useStdout } from "ink";
import React, { createContext, useContext } from "react";

interface TerminalDimensions {
  width: number;
  height: number;
}

const TerminalContext = createContext<TerminalDimensions>({
  width: 80,
  height: 24,
});

/**
 * Hook to access terminal dimensions from any child component.
 *
 * @example
 * const { width, height } = useTerminalDimensions();
 */
export function useTerminalDimensions(): TerminalDimensions {
  return useContext(TerminalContext);
}

interface FullscreenLayoutProps {
  children: React.ReactNode;
}

/**
 * Container component that fills the entire terminal.
 * Provides terminal dimensions via context to children.
 *
 * @example
 * <FullscreenLayout>
 *   <Text>Content fills terminal</Text>
 * </FullscreenLayout>
 */
export const FullscreenLayout: React.FC<FullscreenLayoutProps> = ({
  children,
}) => {
  const { stdout } = useStdout();
  const height = stdout?.rows ?? 24;
  const width = stdout?.columns ?? 80;
  const usableHeight = Math.max(1, height - 2);

  return (
    <TerminalContext.Provider value={{ width, height: usableHeight }}>
      <Box
        flexDirection="column"
        width={width}
        height={usableHeight}
        overflow="hidden"
      >
        {children}
      </Box>
    </TerminalContext.Provider>
  );
};
