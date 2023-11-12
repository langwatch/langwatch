import {
  Card,
  CardBody,
  Container,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Heading,
  Input,
  Spacer,
  Switch,
  VStack,
} from "@chakra-ui/react";
import SettingsLayout, {
  SettingsFormControl,
} from "../components/SettingsLayout";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";

export default function Settings() {
  const { organization } = useOrganizationTeamProject();

  if (!organization) return null;

  return (
    <SettingsLayout>
      <VStack
        paddingX={4}
        paddingY={6}
        spacing={6}
        width="full"
        maxWidth="920px"
        align="start"
      >
        <Heading size="lg" as="h1">
          Organization Settings
        </Heading>
        <Card width="full">
          <CardBody width="full" paddingY={2}>
            <VStack spacing={0}>
              <SettingsFormControl
                label="Name"
                helper="The name of your organization"
              >
                <Input width="full" type="text" value={organization.name} />
              </SettingsFormControl>
              <SettingsFormControl
                label="Slug"
                helper="The unique ID of your organization"
              >
                <Input width="full" disabled type="text" value={organization.slug} />
              </SettingsFormControl>
              <SettingsFormControl
                label="All teams access"
                helper="Members of organization will also be members of all teams"
              >
                <Switch id="joinAllTeams" />
              </SettingsFormControl>
            </VStack>
          </CardBody>
        </Card>
      </VStack>
    </SettingsLayout>
  );
}
