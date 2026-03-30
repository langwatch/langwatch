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
import { useCallback, useRef, useState } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import type { FilterParam } from "~/hooks/useFilterParams";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import monokaiTheme from "~/optimization_studio/components/code/Monokai.json";
import {
  type FilterField,
  sanitizeTriggerFilters,
  triggerFiltersRawSchema,
  type TriggerFilters,
  type TriggerFilterValue,
} from "~/server/filters/types";
import { api } from "~/utils/api";
import { Drawer } from "../components/ui/drawer";
import { Switch } from "../components/ui/switch";
import { toaster } from "../components/ui/toaster";
import { FieldsFilters } from "./filters/FieldsFilters";
import { HorizontalFormControl } from "./HorizontalFormControl";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <Box padding={4} color="fg.muted">
      Loading editor...
    </Box>
  ),
});

function hasNonEmptyFilterParam(value: FilterParam): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Object.values(value).some((nested) =>
    Array.isArray(nested)
      ? nested.length > 0
      : Object.values(nested as Record<string, string[]>).some(
          (items) => items.length > 0,
        ),
  );
}

type ParsedCodeFilters =
  | {
      success: true;
      rawFilters: Record<string, TriggerFilterValue>;
      sanitizedFilters: TriggerFilters;
      unknownFields: string[];
    }
  | { success: false; message: string };

function parseCodeFilters(value: string): ParsedCodeFilters {
  try {
    const parsed = JSON.parse(value);
    const result = triggerFiltersRawSchema.safeParse(parsed);

    if (!result.success) {
      return {
        success: false,
        message: result.error.errors[0]?.message ?? "Invalid filter structure",
      };
    }

    const { sanitizedFilters, unknownFields } = sanitizeTriggerFilters(
      result.data,
    );

    return {
      success: true,
      rawFilters: result.data,
      sanitizedFilters,
      unknownFields,
    };
  } catch {
    return { success: false, message: "Invalid JSON syntax" };
  }
}

export function EditAutomationFilterDrawer({ automationId }: { automationId?: string }) {
  const { project } = useOrganizationTeamProject();

  const updateTriggerFilters = api.automation.updateTriggerFilters.useMutation();

  const queryClient = api.useContext();
  const { closeDrawer } = useDrawer();

  const [isCodeMode, setIsCodeMode] = useState(false);
  const [codeValue, setCodeValue] = useState("{}");
  const [codeError, setCodeError] = useState<string | null>(null);
  const codeValueRef = useRef(codeValue);

  // Keep ref in sync for submit
  codeValueRef.current = codeValue;

  // Local filter state — avoids router.push during drawer animation
  const [localFilters, setLocalFilters] = useState<
    Partial<Record<FilterField, FilterParam>>
  >({});

  // Guard against refetches overwriting unsaved user edits (TanStack Query v4
  // fires onSuccess on every successful fetch, including background refetches)
  const hydratedForRef = useRef<string | undefined>(undefined);

  api.automation.getTriggerById.useQuery(
    {
      triggerId: automationId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!automationId && !!project?.id,
      onSuccess: (data) => {
        const drawerKey = `${project?.id}:${automationId}`;
        if (hydratedForRef.current === drawerKey) return;

        const filters = JSON.parse(data?.filters as string) as Record<
          string,
          FilterParam
        >;
        const { sanitizedFilters } = sanitizeTriggerFilters(
          filters as Record<string, TriggerFilterValue>,
        );
        const filtersToSet = Object.entries(sanitizedFilters).reduce(
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
          {} as Partial<Record<FilterField, FilterParam>>,
        );

        setLocalFilters(filtersToSet);
        setCodeValue(JSON.stringify(filters, null, 2));
        hydratedForRef.current = drawerKey;
      },
    },
  );

  const getNonEmptyFilters = useCallback(() => {
    return Object.fromEntries(
      Object.entries(localFilters).filter(
        ([_, value]) => value !== undefined && hasNonEmptyFilterParam(value),
      ),
    );
  }, [localFilters]);

  const syncVisualToCode = useCallback(() => {
    setCodeValue(JSON.stringify(getNonEmptyFilters(), null, 2));
    setCodeError(null);
  }, [getNonEmptyFilters]);

  // Handle switching between modes
  const handleModeToggle = (checked: boolean) => {
    if (checked && !isCodeMode) {
      // Switching TO code mode - sync visual filters to code
      syncVisualToCode();
    } else if (!checked && isCodeMode) {
      // Switching FROM code mode to visual mode - validate and apply
      const parsed = parseCodeFilters(codeValueRef.current);
      if (!parsed.success) {
        toaster.create({
          title: "Invalid filter structure",
          description: parsed.message,
          type: "error",
          meta: { closable: true },
        });
        return;
      }

      if (
        Object.keys(parsed.rawFilters).length > 0 &&
        Object.keys(parsed.sanitizedFilters).length === 0
      ) {
        toaster.create({
          title: "Unsupported filters only",
          description:
            "This automation only contains unsupported legacy filters. Add a supported filter before switching to visual mode.",
          type: "error",
          meta: { closable: true },
        });
        return;
      }

      if (parsed.unknownFields.length > 0) {
        toaster.create({
          title: "Unsupported filters hidden in visual mode",
          description: `Visual mode does not support: ${parsed.unknownFields.join(", ")}`,
          type: "warning",
          meta: { closable: true },
        });
      }

      setLocalFilters(parsed.sanitizedFilters);
      setCodeError(null);
    }
    setIsCodeMode(checked);
  };

  const validateCode = (value: string): ParsedCodeFilters => {
    const parsed = parseCodeFilters(value);

    if (!parsed.success) {
      setCodeError(parsed.message);
      return parsed;
    }

    if (
      Object.keys(parsed.rawFilters).length > 0 &&
      Object.keys(parsed.sanitizedFilters).length === 0
    ) {
      const message =
        "This automation only contains unsupported legacy filters. Add at least one supported filter before saving.";
      setCodeError(message);
      return { success: false, message };
    }

    setCodeError(null);
    return parsed;
  };

  const onSubmit = () => {
    let filtersToSubmit: Partial<Record<FilterField, FilterParam>> | Record<string, TriggerFilterValue>;

    if (isCodeMode) {
      // Validate code before submitting
      const parsed = validateCode(codeValue);
      if (!parsed.success) {
        toaster.create({
          title: "Error",
          description: codeError ?? "Invalid filter JSON",
          type: "error",
          meta: { closable: true },
        });
        return;
      }
      filtersToSubmit = parsed.rawFilters;
    } else {
      filtersToSubmit = getNonEmptyFilters();
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
          closeDrawer();
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
      onOpenChange={({ open }) => !open && closeDrawer()}
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
                <FieldsFilters
                  filters={localFilters as Record<FilterField, FilterParam>}
                  setFilters={(filters) =>
                    setLocalFilters((prev) => ({ ...prev, ...filters }))
                  }
                />
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
