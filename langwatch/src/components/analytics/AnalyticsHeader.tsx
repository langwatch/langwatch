import { Box, Button, Heading, HStack, Input, Spacer } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { Edit2 } from "lucide-react";
import { LuListTree } from "react-icons/lu";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { FilterToggle } from "../filters/FilterToggle";
import { PeriodSelector, usePeriodSelector } from "../PeriodSelector";
import { Tooltip } from "../ui/tooltip";
import { DashboardLayoutHeader } from "../DashboardLayout";

export interface AnalyticsHeaderProps {
  title: string;
  isEditable?: boolean;
  onTitleSave?: (newTitle: string) => void;
}

export function AnalyticsHeader({
  title,
  isEditable,
  onTitleSave,
}: AnalyticsHeaderProps) {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const [isEditing, setIsEditing] = useState(false);
  const [editingTitle, setEditingTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    period: { startDate, endDate },
    setPeriod,
  } = usePeriodSelector();

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEdit = () => {
    if (!isEditable) return;
    setEditingTitle(title);
    setIsEditing(true);
  };

  const handleFinishEdit = () => {
    if (editingTitle.trim() && editingTitle !== title) {
      onTitleSave?.(editingTitle.trim());
    }
    setIsEditing(false);
    setEditingTitle("");
  };

  return (
    <DashboardLayoutHeader>
      {isEditing ? (
        <Input
          ref={inputRef}
          value={editingTitle}
          onChange={(e) => setEditingTitle(e.target.value)}
          onBlur={handleFinishEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleFinishEdit();
            if (e.key === "Escape") {
              setIsEditing(false);
              setEditingTitle("");
            }
          }}
          fontSize="md"
          fontWeight="500"
          variant="flushed"
          width="auto"
          minWidth="200px"
        />
      ) : (
        <HStack
          cursor={isEditable ? "pointer" : "default"}
          onClick={handleStartEdit}
          _hover={isEditable ? { "& .edit-icon": { opacity: 1 } } : undefined}
        >
          <Heading as={"h1"}>{title}</Heading>
          {isEditable && (
            <Box
              className="edit-icon"
              opacity={0}
              transition="opacity 0.2s"
              color="gray.400"
              paddingTop={1}
            >
              <Edit2 size={16} />
            </Box>
          )}
        </HStack>
      )}
      <Spacer />
      <HStack gap={2}>
        <FilterToggle />
        <PeriodSelector period={{ startDate, endDate }} setPeriod={setPeriod} />
        <Tooltip content="Show traces behind those metrics">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void router.push(
                {
                  pathname: `/${project?.slug}/messages`,
                  query: {
                    ...router.query,
                  },
                },
                undefined,
                { shallow: true },
              );
            }}
          >
            <LuListTree />
            Show Traces
          </Button>
        </Tooltip>
      </HStack>
    </DashboardLayoutHeader>
  );
}
