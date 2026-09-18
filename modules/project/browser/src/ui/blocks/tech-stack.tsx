/**
 * Renders a project's tech stack from onboarding's own selector options.
 * The selector itself lives in `onboarding-browser` — it has one caller
 * (the project-creation screen) plus this settings-page reader.
 */

import { Box, HStack } from "@chakra-ui/react";
import {
  techStackFrameworkOptions,
  techStackLanguageOptions,
} from "@langwatch/onboarding-browser/surfaces/tech-stack";
import type { PropsWithChildren } from "react";

import type { ProjectHostProject as Project } from "../../model/project-host.ts";

export const getTechStack = (project: Project) => {
  const languageKey = project.language as keyof typeof techStackLanguageOptions;
  const frameworkKey = project.framework as keyof typeof techStackFrameworkOptions;
  return {
    language: techStackLanguageOptions[languageKey] ?? techStackLanguageOptions.other,
    framework: techStackFrameworkOptions[frameworkKey] ?? techStackFrameworkOptions.other,
  };
};

export const ProjectTechStackIcon = ({ project }: { project: Project }) => {
  const IconWrapper = ({ children }: PropsWithChildren) => {
    return (
      <Box width="16px" height="16px" display="flex" alignItems="center" justifyContent="center">
        {children}
      </Box>
    );
  };

  const { language, framework } = getTechStack(project);

  if (language.label === "Other" && framework.label === "Other") {
    return (
      <HStack gap={0} align="center" justify="center" color="fg.muted">
        <IconWrapper>{techStackLanguageOptions.other.icon}</IconWrapper>
      </HStack>
    );
  }

  return (
    <HStack gap={0}>
      <Box marginRight="-6px">
        <IconWrapper>{language.icon}</IconWrapper>
      </Box>
      <IconWrapper>{framework.icon}</IconWrapper>
    </HStack>
  );
};
