import { Box, Button, HStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import React, { useState } from "react";

export type ButtonToggleValue = string;

interface ButtonToggleRootProps {
  value: ButtonToggleValue;
  onChange: (value: ButtonToggleValue) => void;
  children: ReactNode;
}

interface ButtonToggleButtonProps {
  value: ButtonToggleValue;
  children: ReactNode;
}

interface ButtonToggleContextValue {
  value: ButtonToggleValue;
  onChange: (value: ButtonToggleValue) => void;
  hoveredValue: ButtonToggleValue | null;
  setHoveredValue: (value: ButtonToggleValue | null) => void;
  valueToIndex: Record<string, number>;
  totalButtons: number;
}

const ButtonToggleContext =
  React.createContext<ButtonToggleContextValue | null>(null);

function useButtonToggle() {
  const context = React.useContext(ButtonToggleContext);
  if (!context) {
    throw new Error(
      "ButtonToggleSlider components must be used within ButtonToggleSlider.Root"
    );
  }
  return context;
}

export const ButtonToggleSlider = {
  Root: function ButtonToggleRoot({
    value,
    onChange,
    children,
  }: ButtonToggleRootProps) {
    const [hoveredValue, setHoveredValue] = useState<ButtonToggleValue | null>(
      null
    );

    // Collect all button values and create index mapping
    const valueToIndex: Record<string, number> = {};
    let buttonCount = 0;

    React.Children.forEach(children, (child) => {
      if (
        React.isValidElement<ButtonToggleButtonProps>(child) &&
        child.type === ButtonToggleButton
      ) {
        const buttonValue = child.props.value;
        if (buttonValue && !valueToIndex.hasOwnProperty(buttonValue)) {
          valueToIndex[buttonValue] = buttonCount++;
        }
      }
    });

    const contextValue: ButtonToggleContextValue = {
      value,
      onChange,
      hoveredValue,
      setHoveredValue,
      valueToIndex,
      totalButtons: buttonCount,
    };

    console.log(contextValue);

    return (
      <ButtonToggleContext.Provider value={contextValue}>
        <HStack
          background="gray.200"
          padding="3px"
          paddingY={0}
          borderRadius="lg"
          gap={0} // Remove gap since we're using transform positioning
          position="relative"
          width="fit-content" // Let content determine width
        >
          <Slider>{children}</Slider>
        </HStack>
      </ButtonToggleContext.Provider>
    );
  },

  Button: ButtonToggleButton,
};

function ButtonToggleButton({ value, children }: ButtonToggleButtonProps) {
  const { onChange, setHoveredValue } = useButtonToggle();
  return (
    <Button
      height="32px"
      variant="ghost"
      _hover={{ background: "none" }}
      onMouseEnter={() => setHoveredValue(value)}
      onMouseLeave={() => setHoveredValue(null)}
      onClick={() => onChange(value)}
    >
      {children}
    </Button>
  );
}

ButtonToggleButton.displayName = "ButtonToggleButton";

// Slider component that moves based on active/hovered state
function Slider({ children }: { children: ReactNode }) {
  const { value, hoveredValue, valueToIndex, totalButtons } = useButtonToggle();
  const activeValue = hoveredValue || value;
  const activeIndex = valueToIndex[activeValue] ?? 0;

  return (
    <>
      <Box
        background="white"
        position="absolute"
        height="26px"
        borderRadius="6px"
        transition="all 0.3s ease-out"
        // Position using flexbox transform instead of hardcoded pixels
        transform={`translateX(${activeIndex * 100}%)`}
        marginX={1}
        width={`calc(${100 / totalButtons}% - ${totalButtons * 2}px)`} // Dynamic width based on total buttons
        left={0}
      />
      {children}
    </>
  );
}
