import {
  Button,
  Field,
  HStack,
  Input,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { OrganizationUserRole } from "@prisma/client";
import { Select as MultiSelect, chakraComponents } from "chakra-react-select";
import { Mail, Trash } from "react-feather";
import {
  Controller,
  useFieldArray,
  useForm,
  type SubmitHandler,
} from "react-hook-form";

type Option = { label: string; value: string; description?: string };

type InviteData = {
  email: string;
  teamOptions: Option[];
  role?: Option;
};

export type MembersForm = {
  invites: InviteData[];
};

interface AddMembersFormProps {
  teamOptions: Option[];
  onSubmit: SubmitHandler<MembersForm>;
  isLoading?: boolean;
  hasEmailProvider?: boolean;
  onClose?: () => void;
  onCloseText?: string;
}

const selectOptions = [
  {
    label: "Admin",
    value: OrganizationUserRole.ADMIN,
    description: "Can manage organization and add or remove members",
  },
  {
    label: "Member",
    value: OrganizationUserRole.MEMBER,
    description: "Can manage their own projects and view other projects",
  },
  {
    label: "External / Viewer",
    value: OrganizationUserRole.EXTERNAL,
    description: "Can only view projects they are invited to, cannot see costs",
  },
];

/**
 * Reusable form component for adding members to an organization
 * Single Responsibility: Handles the form logic and UI for inviting new members
 */
export function AddMembersForm({
  teamOptions,
  onSubmit,
  isLoading = false,
  hasEmailProvider = false,
  onClose,
  onCloseText = "Cancel",
}: AddMembersFormProps) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
    reset: resetForm,
  } = useForm<MembersForm>({
    defaultValues: {
      invites: [{ email: "", teamOptions: teamOptions }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "invites",
  });

  const onAddField = () => {
    append({ email: "", teamOptions });
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void handleSubmit(onSubmit)(e);
  };

  return (
    <form onSubmit={handleFormSubmit}>
      <VStack align="start" gap={4} width="100%">
        <Table.Root variant="line" width="100%">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader paddingLeft={0} paddingTop={0}>
                Email
              </Table.ColumnHeader>
              <Table.ColumnHeader paddingLeft={0} paddingTop={0}>
                Role
              </Table.ColumnHeader>
              <Table.ColumnHeader paddingLeft={0} paddingTop={0}>
                Teams
              </Table.ColumnHeader>
              <Table.ColumnHeader
                paddingLeft={0}
                paddingRight={0}
                paddingTop={0}
              ></Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {fields.map((field, index) => (
              <Table.Row key={field.id}>
                <Table.Cell paddingLeft={0} paddingY={2}>
                  <Field.Root>
                    <Input
                      placeholder="Enter email address"
                      {...register(`invites.${index}.email`, {
                        required: "Email is required",
                      })}
                    />
                    <Field.ErrorText>
                      {errors.invites?.[index]?.email && "Email is required"}
                    </Field.ErrorText>
                  </Field.Root>
                </Table.Cell>
                <Table.Cell width="24%" paddingLeft={0} paddingY={2}>
                  <Field.Root>
                    <Controller
                      control={control}
                      name={`invites.${index}.role`}
                      rules={{ required: "User role is required" }}
                      render={({ field }) => (
                        <MultiSelect
                          {...field}
                          options={selectOptions}
                          hideSelectedOptions={false}
                          isSearchable={false}
                          components={{
                            Menu: ({ children, ...props }) => (
                              <chakraComponents.Menu
                                {...props}
                                innerProps={{
                                  ...props.innerProps,
                                  style: { width: "300px" },
                                }}
                              >
                                {children}
                              </chakraComponents.Menu>
                            ),
                            Option: ({ children, ...props }) => (
                              <chakraComponents.Option {...props}>
                                <VStack align="start">
                                  <Text>{children}</Text>
                                  <Text
                                    color={
                                      props.isSelected ? "white" : "gray.500"
                                    }
                                    fontSize="13px"
                                  >
                                    {props.data.description}
                                  </Text>
                                </VStack>
                              </chakraComponents.Option>
                            ),
                          }}
                        />
                      )}
                    />
                    <Field.ErrorText>
                      {errors.invites?.[index]?.role && "Role is required"}
                    </Field.ErrorText>
                  </Field.Root>
                </Table.Cell>
                <Table.Cell width="35%" paddingLeft={0} paddingY={2}>
                  <Field.Root>
                    <Controller
                      control={control}
                      name={`invites.${index}.teamOptions`}
                      rules={{
                        required: "At least one team is required",
                      }}
                      render={({ field }) => (
                        <MultiSelect
                          {...field}
                          options={teamOptions}
                          isMulti
                          closeMenuOnSelect={false}
                          selectedOptionStyle="check"
                          hideSelectedOptions={false}
                        />
                      )}
                    />
                  </Field.Root>
                </Table.Cell>
                <Table.Cell paddingLeft={0} paddingRight={0} paddingY={2}>
                  <Button
                    type="button"
                    colorPalette="red"
                    onClick={() => remove(index)}
                  >
                    <Trash size={18} />
                  </Button>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
        <Button type="button" onClick={onAddField} marginTop={2}>
          + Add Another
        </Button>

        <HStack justify="end" width="100%" marginTop={4}>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isLoading}
          >
            {onCloseText}
          </Button>
          <Button
            colorPalette={isLoading ? "gray" : "orange"}
            type="submit"
            disabled={isLoading}
          >
            <HStack>
              {isLoading ? <Spinner size="sm" /> : <Mail size={18} />}
              <Text>
                {hasEmailProvider ? "Send invites" : "Create invites"}
              </Text>
            </HStack>
          </Button>
        </HStack>
      </VStack>
    </form>
  );
}
