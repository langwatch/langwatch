import { Box, Button, Heading, HStack, Input, Spacer } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { Edit2 } from "react-feather";
import { LuListTree } from "react-icons/lu";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { FilterToggle } from "../filters/FilterToggle";
import { PeriodSelector, usePeriodSelector } from "../PeriodSelector";
import { Tooltip } from "../ui/tooltip";

interface AnalyticsHeaderProps {
  title: string;
  isEditable?: boolean;
  onTitleSave?: (newTitle: string) => void;
}

export function AnalyticsHeader({ title, isEditable, onTitleSave }: AnalyticsHeaderProps) {
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
    <HStack width="full" align="top" paddingBottom={4}>
      <HStack align="center" gap={6}>
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
            fontSize="2xl"
            fontWeight="bold"
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
            <Heading as={"h1"} size="lg" paddingTop={1}>
              {title}
            </Heading>
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
        <Tooltip content="Show traces behind those metrics">
          <Button
            variant="outline"
            minWidth={0}
            height="32px"
            padding={2}
            marginTop={2}
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
            <LuListTree size="16" />
          </Button>
        </Tooltip>
      </HStack>
      <Spacer />
      <HStack marginBottom="-8px" gap={0}>
        <FilterToggle />
        <PeriodSelector period={{ startDate, endDate }} setPeriod={setPeriod} />
      </HStack>
    </HStack>
  );
}
