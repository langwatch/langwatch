import { Field, Input, VStack, HStack, Text } from "@chakra-ui/react";
import { Check } from "lucide-react";
import { memo } from "react";
import { Popover } from "../ui/popover";

interface AlertDrawerMultiSelectProps {
  open: boolean;
  onOpenChange: (open: { open: boolean }) => void;
  selectedMembers: string[];
  onMemberToggle: (email: string) => void;
  onClose: () => void;
  members?: Array<{
    user: {
      id: string;
      email: string | null;
    };
  }>;
}

export const AlertDrawerMultiSelect = memo(function AlertDrawerMultiSelect({
  open,
  onOpenChange,
  selectedMembers,
  onMemberToggle,
  onClose,
  members = [],
}: AlertDrawerMultiSelectProps) {
  return (
    <VStack width="full" align="start" paddingLeft={7}>
      <Popover.Root
        positioning={{ placement: "bottom" }}
        open={open}
        onOpenChange={onOpenChange}
      >
        <Popover.Trigger width="full">
          <Field.Root width="100%">
            <Input
              placeholder="Select email/s"
              value={selectedMembers.join(", ")}
              readOnly
              width="100%"
            />
          </Field.Root>
        </Popover.Trigger>
        <Popover.Content marginTop="-8px">
          <Popover.CloseTrigger onClick={onClose} zIndex={1000} />
          <Popover.Body>
            <VStack width="full" align="start">
              {members.map((member) => {
                const email = member.user.email ?? "";
                return (
                  <HStack
                    key={member.user.id}
                    cursor="pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMemberToggle(email);
                    }}
                  >
                    <Check
                      size={18}
                      color={selectedMembers.includes(email) ? "green" : "gray"}
                    />
                    <Text>{email}</Text>
                  </HStack>
                );
              })}
            </VStack>
          </Popover.Body>
        </Popover.Content>
      </Popover.Root>
    </VStack>
  );
});

