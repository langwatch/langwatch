import { Box, HStack, Text } from "@chakra-ui/react";
import { Select as MultiSelect, chakraComponents } from "chakra-react-select";
import React from "react";
import models from "../../../models.json";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { api } from "../utils/api";
import { vendorIcons } from "../server/modelProviders/iconsMap";

export type ModelOption = {
  label: string;
  value: string;
  version: string;
  icon: React.ReactNode;
  isDisabled: boolean;
  mode?: "chat" | "embedding" | "evaluator" | undefined;
};

export const modelSelectorOptions: ModelOption[] = Object.entries(models).map(
  ([key, value]) => ({
    label: value.name,
    value: key,
    version: value.version,
    icon: vendorIcons[value.model_vendor],
    isDisabled: false,
    mode: value.mode as "chat" | "embedding" | "evaluator",
  })
);

export const ModelSelector = React.memo(function ModelSelector({
  model,
  options,
  onChange,
  size = "md",
  mode,
}: {
  model: string;
  options: string[];
  onChange: (model: string) => void;
  size?: "sm" | "md";
  mode?: "chat" | "embedding" | "evaluator";
}) {
  const { project } = useOrganizationTeamProject();

  const modelProviders = api.modelProvider.getAllForProject.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id }
  );

  const modelOption = modelSelectorOptions.find(
    (option) => option.value === model && (!mode || option.mode === mode)
  );
  const selectOptions: ModelOption[] = options
    .map((model) => {
      const modelOption = modelSelectorOptions.find(
        (option) => option.value === model
      );

      if (!modelOption) {
        return {
          label: model,
          value: model,
          version: "",
          icon: null,
          isDisabled: true,
          mode: mode,
        };
      }

      const provider = model.split("/")[0]!;
      const modelProvider = modelProviders.data?.[provider];

      return {
        ...modelOption,
        value: modelProvider?.enabled ? modelOption.value : "",
        isDisabled: !modelProvider?.enabled,
      };
    })
    .filter((x) => x);

  return (
    <MultiSelect
      className="fix-hidden-inputs"
      value={modelOption}
      onChange={(option) => option && onChange(option.value)}
      options={selectOptions}
      isSearchable={false}
      chakraStyles={{
        container: (base) => ({
          ...base,
          background: "white",
          width: size === "sm" ? "250px" : "auto",
          borderRadius: "5px",
          padding: 0,
        }),
        valueContainer: (base) => ({
          ...base,
          padding: size === "sm" ? "0px 8px" : "0px 12px",
        }),
        control: (base) => ({
          ...base,
          minHeight: 0,
          height: size === "sm" ? "32px" : "40px",
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
              <Box fontSize={size === "sm" ? 12 : 14} fontFamily="mono">
                {children}
              </Box>
              {(!!props.data.version || props.data.isDisabled) && (
                <Text
                  fontSize={size === "sm" ? 12 : 14}
                  fontFamily="mono"
                  color="gray.400"
                >
                  ({props.data.value ? props.data.version : "disabled"})
                </Text>
              )}
            </HStack>
          </chakraComponents.Option>
        ),
        ValueContainer: ({ children, ...props }) => {
          const { getValue } = props;
          const value = getValue();
          const icon = value.length > 0 ? value[0]?.icon : null;
          const version = value.length > 0 ? value[0]?.version : null;
          const model = value.length > 0 ? value[0]?.value : null;
          const isDisabled =
            selectOptions.find((option) => option.value === model)
              ?.isDisabled ?? true;

          return (
            <chakraComponents.ValueContainer {...props}>
              <HStack spacing={2} align="center" opacity={isDisabled ? 0.5 : 1}>
                <Box width={size === "sm" ? "14px" : "16px"}>{icon}</Box>
                <Box fontSize={size === "sm" ? 12 : 14} fontFamily="mono">
                  {children}
                </Box>
                {(!!version || isDisabled) && (
                  <Text
                    fontSize={size === "sm" ? 12 : 14}
                    fontFamily="mono"
                    color="gray.400"
                  >
                    ({isDisabled ? "disabled" : version})
                  </Text>
                )}
              </HStack>
            </chakraComponents.ValueContainer>
          );
        },
      }}
    />
  );
});
