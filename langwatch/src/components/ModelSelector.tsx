import { Box, HStack, Text } from "@chakra-ui/react";
import { Select as MultiSelect, chakraComponents } from "chakra-react-select";
import React from "react";
import { Anthropic } from "./icons/Anthropic";
import { Azure } from "./icons/Azure";
import { Meta } from "./icons/Meta";
import { Mistral } from "./icons/Mistral";
import { OpenAI } from "./icons/OpenAI";
import { api } from "../utils/api";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import models from "../../../models.json";
import { Google } from "./icons/Google";

export type ModelOption = {
  label: string;
  value: string;
  version: string;
  icon: React.ReactNode;
  isDisabled: boolean;
};

const vendorIcons: Record<string, React.ReactNode> = {
  azure: <Azure />,
  openai: <OpenAI />,
  meta: <Meta />,
  mistral: <Mistral />,
  anthropic: <Anthropic />,
  google: <Google />,
};

export const modelSelectorOptions: ModelOption[] = Object.entries(models).map(
  ([key, value]) => ({
    label: value.name,
    value: key,
    version: value.version,
    icon: vendorIcons[value.model_vendor],
    isDisabled: false,
  })
);

export const ModelSelector = React.memo(function ModelSelector({
  model,
  options,
  onChange,
}: {
  model: string;
  options: string[];
  onChange: (model: string) => void;
}) {
  const { project } = useOrganizationTeamProject();

  const modelProviders = api.modelProvider.getAllForProject.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id }
  );

  const modelOption = modelSelectorOptions.find(
    (option) => option.value === model
  );
  const selectOptions: ModelOption[] = options
    .map((model) => {
      const modelOption = modelSelectorOptions.find(
        (option) => option.value === model
      )!;

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
                ({props.data.value ? props.data.version : "disabled"})
              </Text>
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
                <Box width="14px">{icon}</Box>
                <Box fontSize={12} fontFamily="mono">
                  {children}
                </Box>
                <Text fontSize={12} fontFamily="mono" color="gray.400">
                  ({isDisabled ? "disabled" : version})
                </Text>
              </HStack>
            </chakraComponents.ValueContainer>
          );
        },
      }}
    />
  );
});
