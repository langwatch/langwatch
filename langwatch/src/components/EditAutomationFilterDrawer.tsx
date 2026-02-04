import {
  Box,
  Button,
  Heading,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { Monaco } from "@monaco-editor/react";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { useCallback, useRef, useState } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import { useFilterParams } from "~/hooks/useFilterParams";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import monokaiTheme from "~/optimization_studio/components/code/Monokai.json";
import {
  type FilterField,
  triggerFiltersSchema,
} from "~/server/filters/types";
import { api } from "~/utils/api";
import { Drawer } from "../components/ui/drawer";
import { Switch } from "../components/ui/switch";
import { toaster } from "../components/ui/toaster";
import { QueryStringFieldsFilters } from "./filters/FieldsFilters";
import { HorizontalFormControl } from "./HorizontalFormControl";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <Box padding={4} color="fg.muted">
      Loading editor...
    </Box>
  ),
});

export function EditAutomationFilterDrawer({ automationId }: { automationId?: string }) {
  const { project } = useOrganizationTeamProject();

  const updateTriggerFilters = api.automation.updateTriggerFilters.useMutation();
  const { getLatestFilters, clearFilters, setFilters } = useFilterParams();
  const router = useRouter();

  const queryClient = api.useContext();
  const { closeDrawer } = useDrawer();

  const [isCodeMode, setIsCodeMode] = useState(false);
  const [codeValue, setCodeValue] = useState("{}");
  const [codeError, setCodeError] = useState<string | null>(null);
  const codeValueRef = useRef(codeValue);

  // Keep ref in sync for submit
  codeValueRef.current = codeValue;

  api.automation.getTriggerById.useQuery(
    {
      triggerId: automationId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!automationId && !!project?.id,
      onSuccess: (data) => {
        const filters = JSON.parse(data?.filters as string) as Record<
          string,
          string[] | Record<string, string[]>
        >;
        const filtersToSet = Object.entries(filters).reduce(
          (acc, [key, value]) => {
            if (Array.isArray(value)) {
              if (value.length > 0) {
                acc[key as FilterField] = value;
              }
            } else if (typeof value === "object" && value !== null) {
              acc[key as FilterField] = value;
            }
            return acc;
          },
          {} as Record<FilterField, string[] | Record<string, string[]>>,
        );

        setFilters(filtersToSet);
        setCodeValue(JSON.stringify(filters, null, 2));
      },
    },
  );

  const syncVisualToCode = useCallback(() => {
    const filterParams = getLatestFilters();
    const nonEmptyFilters = Object.fromEntries(
      Object.entries(filterParams.filters).filter(([_, value]) =>
        Array.isArray(value)
          ? value.length > 0
          : Object.keys(value as Record<string, string[]>).length > 0,
      ),
    );
    setCodeValue(JSON.stringify(nonEmptyFilters, null, 2));
    setCodeError(null);
  }, [getLatestFilters]);

  // Handle switching between modes
  const handleModeToggle = (checked: boolean) => {
    if (checked && !isCodeMode) {
      // Switching TO code mode - sync visual filters to code
      syncVisualToCode();
    } else if (!checked && isCodeMode) {
      // Switching FROM code mode to visual mode - validate and apply
      try {
        const parsed = JSON.parse(codeValueRef.current);
        const result = triggerFiltersSchema.safeParse(parsed);
        if (!result.success) {
          toaster.create({
            title: "Invalid filter structure",
            description: result.error.errors[0]?.message ?? "Invalid JSON structure",
            type: "error",
            meta: { closable: true },
          });
          return;
        }
        setFilters(parsed);
        setCodeError(null);
      } catch {
        toaster.create({
          title: "Invalid JSON",
          description: "Please fix the JSON syntax before switching modes",
          type: "error",
          meta: { closable: true },
        });
        return;
      }
    }
    setIsCodeMode(checked);
  };

  const validateCode = (value: string): boolean => {
    try {
      const parsed = JSON.parse(value);
      const result = triggerFiltersSchema.safeParse(parsed);
      if (!result.success) {
        setCodeError(result.error.errors[0]?.message ?? "Invalid filter structure");
        return false;
      }
      setCodeError(null);
      return true;
    } catch {
      setCodeError("Invalid JSON syntax");
      return false;
    }
  };

  const onSubmit = () => {
    let filtersToSubmit: Record<string, unknown>;

    if (isCodeMode) {
      // Validate code before submitting
      if (!validateCode(codeValue)) {
        toaster.create({
          title: "Error",
          description: codeError ?? "Invalid filter JSON",
          type: "error",
          meta: { closable: true },
        });
        return;
      }
      filtersToSubmit = JSON.parse(codeValue);
    } else {
      const filterParams = getLatestFilters();
      filtersToSubmit = Object.fromEntries(
        Object.entries(filterParams.filters).filter(([_, value]) =>
          Array.isArray(value)
            ? value.length > 0
            : Object.keys(value as Record<string, string[]>).length > 0,
        ),
      );
    }

    if (Object.keys(filtersToSubmit).length === 0) {
      toaster.create({
        title: "Error",
        description: "Please add at least one filter",
        type: "error",
        meta: { closable: true },
      });
      return;
    }

    updateTriggerFilters.mutate(
      {
        projectId: project?.id ?? "",
        triggerId: automationId ?? "",
        filters: filtersToSubmit,
      },
      {
        onSuccess: () => {
          toaster.create({
            title: "Automation Updated",
            description: `You have successfully updated the automation`,
            type: "success",
            meta: { closable: true },
          });

          void queryClient.automation.getTriggers.invalidate();
          clearFilters();
          void router.replace({
            pathname: router.pathname,
            query: { project: router.query.project },
          });
        },
        onError: () => {
          toaster.create({
            title: "Error",
            description: "Error updating automation",
            type: "error",
            meta: { closable: true },
          });
        },
      },
    );
  };

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="lg"
      onOpenChange={() => closeDrawer()}
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.CloseTrigger />
          <Heading>Edit Automation Filter</Heading>
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={4}>
            <HStack justify="flex-end">
              <Text fontSize="sm" color="fg.muted">
                Code mode
              </Text>
              <Switch
                checked={isCodeMode}
                onCheckedChange={({ checked }) => handleModeToggle(checked)}
              />
            </HStack>

            {isCodeMode ? (
              <VStack align="stretch" gap={2}>
                <Text fontSize="sm" color="fg.muted">
                  Edit the automation filters as JSON.
                </Text>
                <Box
                  border="1px solid"
                  borderColor={codeError ? "red.500" : "gray.700"}
                  borderRadius="md"
                  overflow="hidden"
                  height="400px"
                  background="#272822"
                >
                  <MonacoEditor
                    height="100%"
                    language="json"
                    defaultValue={codeValue}
                    theme="monokai"
                    beforeMount={(monaco: Monaco) => {
                      monaco.editor.defineTheme(
                        "monokai",
                        monokaiTheme as Parameters<
                          typeof monaco.editor.defineTheme
                        >[1],
                      );
                    }}
                    onChange={(value) => {
                      const newValue = value ?? "{}";
                      setCodeValue(newValue);
                      validateCode(newValue);
                    }}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      wordWrap: "on",
                      automaticLayout: true,
                      scrollBeyondLastLine: false,
                      lineNumbers: "on",
                      tabSize: 2,
                      padding: { top: 12 },
                    }}
                  />
                </Box>
                {codeError && (
                  <Text fontSize="sm" color="red.500">
                    {codeError}
                  </Text>
                )}
              </VStack>
            ) : (
              <HorizontalFormControl
                label="Current filters"
                helper="Add or remove filters to the automation."
                minWidth="calc(50% - 16px)"
              >
                <QueryStringFieldsFilters hideTriggerButton />
              </HorizontalFormControl>
            )}

            <HStack justifyContent="flex-end" marginY={5}>
              <Button
                colorPalette="blue"
                type="submit"
                minWidth="fit-content"
                loading={updateTriggerFilters.isLoading}
                onClick={onSubmit}
              >
                Update Filters
              </Button>
            </HStack>
          </VStack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
