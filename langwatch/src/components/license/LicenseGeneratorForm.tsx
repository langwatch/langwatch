import { useState, useEffect } from "react";
import {
  Box,
  Button,
  HStack,
  Input,
  NativeSelect,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { api } from "~/utils/api";
import { toaster } from "../ui/toaster";
import {
  PRO_TEMPLATE,
  ENTERPRISE_TEMPLATE,
  type LicensePlanLimits,
} from "../../../ee/licensing";

interface LicenseGeneratorFormProps {
  organizationId: string;
}

type PlanType = "PRO" | "ENTERPRISE" | "CUSTOM";

interface FormData {
  privateKey: string;
  organizationName: string;
  email: string;
  expiresAt: string;
  planType: PlanType;
  maxMembers: number;
  maxProjects: number;
  maxMessagesPerMonth: number;
  evaluationsCredit: number;
  maxWorkflows: number;
  maxPrompts: number;
  maxEvaluators: number;
  maxScenarios: number;
  canPublish: boolean;
}

const defaultFormData: FormData = {
  privateKey: "",
  organizationName: "",
  email: "",
  expiresAt: "",
  planType: "PRO",
  maxMembers: PRO_TEMPLATE.maxMembers,
  maxProjects: PRO_TEMPLATE.maxProjects,
  maxMessagesPerMonth: PRO_TEMPLATE.maxMessagesPerMonth,
  evaluationsCredit: PRO_TEMPLATE.evaluationsCredit,
  maxWorkflows: PRO_TEMPLATE.maxWorkflows,
  maxPrompts: PRO_TEMPLATE.maxPrompts ?? 50,
  maxEvaluators: PRO_TEMPLATE.maxEvaluators ?? 50,
  maxScenarios: PRO_TEMPLATE.maxScenarios ?? 50,
  canPublish: PRO_TEMPLATE.canPublish,
};

function getPlanDefaults(planType: PlanType): Partial<FormData> {
  switch (planType) {
    case "PRO":
      return {
        maxMembers: PRO_TEMPLATE.maxMembers,
        maxProjects: PRO_TEMPLATE.maxProjects,
        maxMessagesPerMonth: PRO_TEMPLATE.maxMessagesPerMonth,
        evaluationsCredit: PRO_TEMPLATE.evaluationsCredit,
        maxWorkflows: PRO_TEMPLATE.maxWorkflows,
        maxPrompts: PRO_TEMPLATE.maxPrompts ?? 50,
        maxEvaluators: PRO_TEMPLATE.maxEvaluators ?? 50,
        maxScenarios: PRO_TEMPLATE.maxScenarios ?? 50,
        canPublish: PRO_TEMPLATE.canPublish,
      };
    case "ENTERPRISE":
      return {
        maxMembers: ENTERPRISE_TEMPLATE.maxMembers,
        maxProjects: ENTERPRISE_TEMPLATE.maxProjects,
        maxMessagesPerMonth: ENTERPRISE_TEMPLATE.maxMessagesPerMonth,
        evaluationsCredit: ENTERPRISE_TEMPLATE.evaluationsCredit,
        maxWorkflows: ENTERPRISE_TEMPLATE.maxWorkflows,
        maxPrompts: ENTERPRISE_TEMPLATE.maxPrompts ?? 1000,
        maxEvaluators: ENTERPRISE_TEMPLATE.maxEvaluators ?? 1000,
        maxScenarios: ENTERPRISE_TEMPLATE.maxScenarios ?? 1000,
        canPublish: ENTERPRISE_TEMPLATE.canPublish,
      };
    case "CUSTOM":
      // Keep current values for custom
      return {};
  }
}

export function LicenseGeneratorForm({ organizationId }: LicenseGeneratorFormProps) {
  const [formData, setFormData] = useState<FormData>(defaultFormData);
  const [generatedLicense, setGeneratedLicense] = useState<string>("");

  const generateMutation = api.license.generate.useMutation({
    onSuccess: (data) => {
      setGeneratedLicense(data.licenseKey);
      toaster.create({
        title: "License generated",
        description: "Your license key has been generated successfully.",
        type: "success",
      });
    },
    onError: (error) => {
      toaster.create({
        title: "Failed to generate license",
        description: error.message,
        type: "error",
      });
    },
  });

  const handlePlanTypeChange = (newPlanType: PlanType) => {
    const defaults = getPlanDefaults(newPlanType);
    setFormData((prev) => ({
      ...prev,
      planType: newPlanType,
      ...defaults,
    }));
  };

  const handleInputChange = (field: keyof FormData, value: string | number | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleGenerate = () => {
    generateMutation.mutate({
      organizationId,
      privateKey: formData.privateKey,
      organizationName: formData.organizationName,
      email: formData.email,
      expiresAt: new Date(formData.expiresAt),
      planType: formData.planType,
      plan: {
        maxMembers: formData.maxMembers,
        maxProjects: formData.maxProjects,
        maxMessagesPerMonth: formData.maxMessagesPerMonth,
        evaluationsCredit: formData.evaluationsCredit,
        maxWorkflows: formData.maxWorkflows,
        maxPrompts: formData.maxPrompts,
        maxEvaluators: formData.maxEvaluators,
        maxScenarios: formData.maxScenarios,
        canPublish: formData.canPublish,
      },
    });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedLicense);
      toaster.create({
        title: "License copied to clipboard",
        type: "success",
      });
    } catch {
      toaster.create({
        title: "Failed to copy",
        description: "Please copy the license manually.",
        type: "error",
      });
    }
  };

  const handleReset = () => {
    setFormData(defaultFormData);
    setGeneratedLicense("");
  };

  const isFormValid =
    formData.privateKey.trim() !== "" &&
    formData.organizationName.trim() !== "" &&
    formData.email.trim() !== "" &&
    formData.expiresAt !== "";

  if (generatedLicense) {
    return (
      <VStack align="start" gap={4} width="full">
        <Text fontSize="sm" fontWeight="medium" color="green.600">
          License generated successfully!
        </Text>
        <Textarea
          value={generatedLicense}
          readOnly
          fontFamily="mono"
          fontSize="xs"
          rows={8}
          width="full"
        />
        <HStack>
          <Button colorScheme="blue" size="sm" onClick={handleCopy}>
            Copy to Clipboard
          </Button>
          <Button variant="outline" size="sm" onClick={handleReset}>
            Generate Another
          </Button>
        </HStack>
      </VStack>
    );
  }

  return (
    <VStack align="start" gap={4} width="full">
      {/* Private Key */}
      <VStack align="start" gap={1} width="full">
        <Text fontSize="sm" fontWeight="medium">
          Private Key
        </Text>
        <Textarea
          value={formData.privateKey}
          onChange={(e) => handleInputChange("privateKey", e.target.value)}
          placeholder="Paste your RSA private key here..."
          fontFamily="mono"
          fontSize="xs"
          rows={6}
        />
      </VStack>

      {/* Organization Name */}
      <VStack align="start" gap={1} width="full">
        <Text fontSize="sm" fontWeight="medium">
          Organization Name
        </Text>
        <Input
          value={formData.organizationName}
          onChange={(e) => handleInputChange("organizationName", e.target.value)}
          placeholder="Acme Corp"
          size="sm"
        />
      </VStack>

      {/* Email */}
      <VStack align="start" gap={1} width="full">
        <Text fontSize="sm" fontWeight="medium">
          Email
        </Text>
        <Input
          value={formData.email}
          onChange={(e) => handleInputChange("email", e.target.value)}
          placeholder="admin@acme.corp"
          type="email"
          size="sm"
        />
      </VStack>

      {/* Expiration Date */}
      <VStack align="start" gap={1} width="full">
        <Text fontSize="sm" fontWeight="medium">
          Expiration Date
        </Text>
        <Input
          value={formData.expiresAt}
          onChange={(e) => handleInputChange("expiresAt", e.target.value)}
          type="date"
          size="sm"
        />
      </VStack>

      {/* Plan Type */}
      <VStack align="start" gap={1} width="full">
        <Text fontSize="sm" fontWeight="medium">
          Plan Type
        </Text>
        <NativeSelect.Root size="sm">
          <NativeSelect.Field
            value={formData.planType}
            onChange={(e) => handlePlanTypeChange(e.target.value as PlanType)}
          >
            <option value="PRO">Pro</option>
            <option value="ENTERPRISE">Enterprise</option>
            <option value="CUSTOM">Custom</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </VStack>

      {/* Plan Limits */}
      <Box width="full" borderWidth="1px" borderRadius="md" padding={4}>
        <VStack align="start" gap={3}>
          <Text fontSize="sm" fontWeight="semibold">
            Plan Limits
          </Text>

          <HStack width="full" gap={4}>
            <VStack align="start" gap={1} flex={1}>
              <Text fontSize="xs" color="gray.500">
                Max Members
              </Text>
              <Input
                value={formData.maxMembers}
                onChange={(e) => handleInputChange("maxMembers", parseInt(e.target.value) || 0)}
                type="number"
                size="sm"
              />
            </VStack>
            <VStack align="start" gap={1} flex={1}>
              <Text fontSize="xs" color="gray.500">
                Max Projects
              </Text>
              <Input
                value={formData.maxProjects}
                onChange={(e) => handleInputChange("maxProjects", parseInt(e.target.value) || 0)}
                type="number"
                size="sm"
              />
            </VStack>
          </HStack>

          <HStack width="full" gap={4}>
            <VStack align="start" gap={1} flex={1}>
              <Text fontSize="xs" color="gray.500">
                Max Messages/Month
              </Text>
              <Input
                value={formData.maxMessagesPerMonth}
                onChange={(e) => handleInputChange("maxMessagesPerMonth", parseInt(e.target.value) || 0)}
                type="number"
                size="sm"
              />
            </VStack>
            <VStack align="start" gap={1} flex={1}>
              <Text fontSize="xs" color="gray.500">
                Evaluations Credit
              </Text>
              <Input
                value={formData.evaluationsCredit}
                onChange={(e) => handleInputChange("evaluationsCredit", parseInt(e.target.value) || 0)}
                type="number"
                size="sm"
              />
            </VStack>
          </HStack>

          <HStack width="full" gap={4}>
            <VStack align="start" gap={1} flex={1}>
              <Text fontSize="xs" color="gray.500">
                Max Workflows
              </Text>
              <Input
                value={formData.maxWorkflows}
                onChange={(e) => handleInputChange("maxWorkflows", parseInt(e.target.value) || 0)}
                type="number"
                size="sm"
              />
            </VStack>
            <VStack align="start" gap={1} flex={1}>
              <Text fontSize="xs" color="gray.500">
                Max Prompts
              </Text>
              <Input
                value={formData.maxPrompts}
                onChange={(e) => handleInputChange("maxPrompts", parseInt(e.target.value) || 0)}
                type="number"
                size="sm"
              />
            </VStack>
          </HStack>

          <HStack width="full" gap={4}>
            <VStack align="start" gap={1} flex={1}>
              <Text fontSize="xs" color="gray.500">
                Max Evaluators
              </Text>
              <Input
                value={formData.maxEvaluators}
                onChange={(e) => handleInputChange("maxEvaluators", parseInt(e.target.value) || 0)}
                type="number"
                size="sm"
              />
            </VStack>
            <VStack align="start" gap={1} flex={1}>
              <Text fontSize="xs" color="gray.500">
                Max Scenarios
              </Text>
              <Input
                value={formData.maxScenarios}
                onChange={(e) => handleInputChange("maxScenarios", parseInt(e.target.value) || 0)}
                type="number"
                size="sm"
              />
            </VStack>
          </HStack>

          <HStack width="full" gap={2} alignItems="center">
            <input
              type="checkbox"
              checked={formData.canPublish}
              onChange={(e) => handleInputChange("canPublish", e.target.checked)}
            />
            <Text fontSize="xs" color="gray.500">
              Can Publish
            </Text>
          </HStack>
        </VStack>
      </Box>

      {/* Generate Button */}
      <Button
        colorScheme="blue"
        size="sm"
        onClick={handleGenerate}
        loading={generateMutation.isLoading}
        disabled={!isFormValid || generateMutation.isLoading}
      >
        Generate License
      </Button>
    </VStack>
  );
}
