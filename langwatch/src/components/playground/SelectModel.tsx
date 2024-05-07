import { Box, HStack, Text } from "@chakra-ui/react";
import { Select as MultiSelect, chakraComponents } from "chakra-react-select";
import React from "react";
import {
  modelOptions,
  usePlaygroundStore,
} from "../../hooks/usePlaygroundStore";

export const SelectModel = React.memo(function SelectModel({
  tabIndex,
  windowId,
}: {
  tabIndex: number;
  windowId: string;
}) {
  const { model, setModel } = usePlaygroundStore((state) => {
    const { model } = state.tabs[tabIndex]!.chatWindows.find(
      (window) => window.id === windowId
    )!;

    return {
      model,
      setModel: state.setModel,
    };
  });

  return (
    <MultiSelect
      className="fix-hidden-inputs"
      value={model}
      onChange={(value) => value && setModel(windowId, value)}
      options={modelOptions}
      isSearchable={false}
      chakraStyles={{
        container: (base) => ({
          ...base,
          background: "white",
          width: "250px",
          borderRadius: "5px",
          padding: 0,
        }),
        valueContainer: (base) => ({
          ...base,
          padding: "0px 8px",
        }),
        control: (base) => ({
          ...base,
          minHeight: 0,
          height: "32px",
        }),
        dropdownIndicator: (provided) => ({
          ...provided,
          background: "white",
          padding: 0,
          paddingRight: 2,
          width: "auto",
          border: "none",
        }),
        indicatorSeparator: (provided) => ({
          ...provided,
          display: "none",
        }),
      }}
      components={{
        Option: ({ children, ...props }) => (
          <chakraComponents.Option {...props}>
            <HStack spacing={2} align="center">
              <Box width="14px">{props.data.icon}</Box>
              <Box fontSize={12} fontFamily="mono">
                {children}
              </Box>
              <Text fontSize={12} fontFamily="mono" color="gray.400">
                ({props.data.version})
              </Text>
            </HStack>
          </chakraComponents.Option>
        ),
        ValueContainer: ({ children, ...props }) => {
          const { getValue } = props;
          const value = getValue();
          const icon = value.length > 0 ? value[0]?.icon : null;
          const version = value.length > 0 ? value[0]?.version : null;

          return (
            <chakraComponents.ValueContainer {...props}>
              <HStack spacing={2} align="center">
                <Box width="14px">{icon}</Box>
                <Box fontSize={12} fontFamily="mono">
                  {children}
                </Box>
                <Text fontSize={12} fontFamily="mono" color="gray.400">
                  ({version})
                </Text>
              </HStack>
            </chakraComponents.ValueContainer>
          );
        },
      }}
    />
  );
});
