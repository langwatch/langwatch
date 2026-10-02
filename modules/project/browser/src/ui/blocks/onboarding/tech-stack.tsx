/**
 * Project language and framework selector with icons; moved to project once
 * before, moved back so `project-browser` stops reaching into onboarding for
 * its one caller and this is the caller's own module.
 */

import { RadioGroup } from "@chakra-ui/react";
import { Box, Field, HStack, VStack } from "@langwatch/design-system/primitives";
import { Code } from "lucide-react";

import { Azure } from "../../elements/onboarding/icons/azure.tsx";
import { DSPy } from "../../elements/onboarding/icons/ds-py.tsx";
import { LangChainParrot } from "../../elements/onboarding/icons/lang-chain-parrot.tsx";
import { OpenAI } from "../../elements/onboarding/icons/open-ai.tsx";
import { PuzzleIcon } from "../../elements/onboarding/icons/puzzle-icon.tsx";
import { Python } from "../../elements/onboarding/icons/python.tsx";
import { TypeScript } from "../../elements/onboarding/icons/type-script.tsx";
import { Vercel } from "../../elements/onboarding/icons/vercel.tsx";
import { RadioCard } from "../../elements/onboarding/radio-card.tsx";

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

interface TechStackForm {
  setValue(name: "language" | "framework", value: string): void;
}

/** The form owner watches `language` and `framework` and hands them in; this only sets them. */
export function TechStackSelector({
  form,
  language,
  framework,
}: {
  form: TechStackForm;
  language: string;
  framework: string;
}) {
  const IconWrapper = ({ children }: { children: React.ReactNode }) => {
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

  const currentLanguage = language || Object.keys(techStackLanguageOptions)[0];

  const handleLanguageChange = (value: string) => {
    const availableForLanguage = Object.entries(techStackFrameworkOptions).filter(([, framework]) =>
      Object.keys(framework.languages).includes(value),
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
        <RadioGroup.Root
          value={language}
          onValueChange={(change) => handleLanguageChange(change.value ?? "")}
        >
          <HStack gap={3} alignItems="stretch" wrap="wrap">
            {Object.entries(techStackLanguageOptions).map(([key, option]) => (
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
      </Field.Root>
      <Field.Root>
        <Field.Label>Library or Framework</Field.Label>
        <RadioGroup.Root
          value={framework}
          onValueChange={(change) => form.setValue("framework", change.value ?? "")}
        >
          <HStack gap={3} alignItems="stretch" wrap="wrap">
            {Object.entries(techStackFrameworkOptions)
              .filter(([, option]) => Object.keys(option.languages).includes(currentLanguage ?? ""))
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
      </Field.Root>
    </>
  );
}
