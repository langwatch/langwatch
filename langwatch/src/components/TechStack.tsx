import { Box, Field, HStack, RadioGroup, VStack } from "@chakra-ui/react";
import type { Project } from "@prisma/client";
import { type PropsWithChildren } from "react";
import { Code } from "react-feather";
import { Controller, type UseFormReturn } from "react-hook-form";
import { RadioCard } from "~/pages/onboarding/[team]/project";
import { Azure } from "./icons/Azure";
import { DSPy } from "./icons/DSPy";
import { LangChainParrot } from "./icons/LangChainParrot";
import { OpenAI } from "./icons/OpenAI";
import { Python } from "./icons/Python";
import { TypeScript } from "./icons/TypeScript";
import { Vercel } from "./icons/Vercel";
import { PuzzleIcon } from "./icons/PuzzleIcon";

export type ProjectFormData = {
  name: string;
  language: string;
  framework: string;
  teamId: string;
  newTeamName: string;
  projectType?: string;
};

type DocsLink = {
  icon: React.ReactNode;
  label: string;
  href: string;
};

export const techStackLanguageOptions = {
  python: {
    label: "Python",
    icon: <Python />,
  },
  typescript: {
    label: "TypeScript",
    icon: <TypeScript />,
  },
  other: { label: "Other", icon: <PuzzleIcon /> },
};

type LanguagesMap = {
  [K in keyof typeof techStackLanguageOptions]?: DocsLink;
};

export const docsLinks = {
  python_openai: {
    label: "Python OpenAI",
    icon: <Python />,
    href: "https://docs.langwatch.ai/integration/python/guide",
  },
  python_azure_openai: {
    label: "Python Azure OpenAI",
    icon: <Python />,
    href: "https://docs.langwatch.ai/integration/python/guide",
  },
  python_langchain: {
    label: "Python LangChain",
    icon: <Python />,
    href: "https://docs.langwatch.ai/integration/python/guide",
  },
  python_dspy: {
    label: "Python DSPy",
    icon: <Python />,
    href: "https://docs.langwatch.ai/integration/python/guide",
  },
  python_custom: {
    label: "Python Custom",
    icon: <Python />,
    href: "https://docs.langwatch.ai/integration/python/guide",
  },
  typescript_guide: {
    label: "TypeScript",
    icon: <TypeScript />,
    href: "https://docs.langwatch.ai/integration/typescript/guide",
  },
  custom_rest: {
    label: "Custom REST",
    icon: <Code />,
    href: "https://docs.langwatch.ai/integration/rest-api",
  },
} satisfies Record<string, DocsLink>;

export const techStackFrameworkOptions = {
  openai: {
    label: "OpenAI",
    icon: <OpenAI />,
    languages: {
      python: docsLinks.python_openai,
      typescript: docsLinks.typescript_guide,
    } as LanguagesMap,
  },
  azure_openai: {
    label: "Azure OpenAI",
    icon: <Azure />,
    languages: {
      python: docsLinks.python_azure_openai,
      typescript: docsLinks.typescript_guide,
    } as LanguagesMap,
  },
  vercel_ai: {
    label: "Vercel AI SDK",
    icon: <Vercel />,
    languages: {
      typescript: docsLinks.typescript_guide,
    } as LanguagesMap,
  },
  langchain: {
    label: "LangChain",
    icon: <LangChainParrot />,
    languages: {
      python: docsLinks.python_langchain,
      typescript: docsLinks.typescript_guide,
    } as LanguagesMap,
  },
  dspy: {
    label: "DSPy",
    icon: <DSPy />,
    languages: {
      python: docsLinks.python_dspy,
    } as LanguagesMap,
  },
  other: {
    label: "Other",
    icon: <PuzzleIcon />,
    languages: {
      python: docsLinks.python_custom,
      typescript: docsLinks.typescript_guide,
      other: docsLinks.custom_rest,
    } as LanguagesMap,
  },
};

export const getTechStack = (project: Project) => {
  const languageKey = project.language as keyof typeof techStackLanguageOptions;
  const frameworkKey =
    project.framework as keyof typeof techStackFrameworkOptions;
  return {
    language:
      techStackLanguageOptions[languageKey] ?? techStackLanguageOptions.other,
    framework:
      techStackFrameworkOptions[frameworkKey] ??
      techStackFrameworkOptions.other,
  };
};

export function TechStackSelector<
  T extends { language: string; framework: string },
>({ form: form_ }: { form: UseFormReturn<T> }) {
  const form = form_ as unknown as UseFormReturn<{
    language: string;
    framework: string;
  }>;
  const IconWrapper = ({ children }: PropsWithChildren) => {
    return (
      <Box
        width="32px"
        height="32px"
        display="flex"
        alignItems="center"
        justifyContent="center"
        overflow="hidden"
        _icon={{
          width: "32px",
          height: "32px",
        }}
      >
        {children}
      </Box>
    );
  };

  const currentLanguage =
    form.watch("language") || Object.keys(techStackLanguageOptions)[0];

  const handleLanguageChange = (value: string) => {
    const availableForLanguage = Object.entries(
      techStackFrameworkOptions
    ).filter(([_, framework]) =>
      Object.keys(framework.languages).includes(value)
    );

    form.setValue("language", value);
    if (availableForLanguage[0]) {
      form.setValue("framework", availableForLanguage[0][0]);
    }
  };

  return (
    <>
      <Field.Root>
        <Field.Label>Language</Field.Label>
        <Controller
          name="language"
          control={form.control}
          render={({ field }) => (
            <RadioGroup.Root
              {...field}
              onChange={undefined}
              onValueChange={(change) => {
                handleLanguageChange(change.value ?? "");
              }}
            >
              <HStack gap={6} alignItems="stretch" wrap="wrap">
                {Object.entries(techStackLanguageOptions).map(
                  ([key, option]) => (
                    <RadioCard key={key} value={key}>
                      <VStack width="64px">
                        <IconWrapper>{option.icon}</IconWrapper>
                        <Box fontSize="sm" textAlign="center">
                          {option.label}
                        </Box>
                      </VStack>
                    </RadioCard>
                  )
                )}
              </HStack>
            </RadioGroup.Root>
          )}
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>Library or Framework</Field.Label>
        <Controller
          name="framework"
          control={form.control}
          render={({ field }) => (
            <RadioGroup.Root {...field}>
              <HStack gap={6} alignItems="stretch" wrap="wrap">
                {Object.entries(techStackFrameworkOptions)
                  .filter(([_, option]) =>
                    Object.keys(option.languages).includes(
                      currentLanguage ?? ""
                    )
                  )
                  .map(([key, option]) => (
                    <RadioCard key={key} value={key}>
                      <VStack width="64px">
                        <IconWrapper>{option.icon}</IconWrapper>
                        <Box fontSize="sm" textAlign="center">
                          {option.label}
                        </Box>
                      </VStack>
                    </RadioCard>
                  ))}
              </HStack>
            </RadioGroup.Root>
          )}
        />
      </Field.Root>
    </>
  );
}

export const ProjectTechStackIcon = ({ project }: { project: Project }) => {
  const IconWrapper = ({ children }: PropsWithChildren) => {
    return (
      <Box
        width="16px"
        height="16px"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        {children}
      </Box>
    );
  };

  const { language, framework } = getTechStack(project);

  if (language.label === "Other" && framework.label === "Other") {
    return (
      <HStack gap={0} align="center" justify="center" color="gray.600">
        <IconWrapper>
          <PuzzleIcon />
        </IconWrapper>
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
