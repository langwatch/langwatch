/**
 * `/onboarding/:team/project` — the first project a new organization creates, on the same
 * branded card as the sign-in doors: centred on a wide screen, full bleed on a phone.
 */

import { Button, Field, Input, NativeSelect, Text, VStack } from "@chakra-ui/react";
import { useRouter } from "@langwatch/browser-host/use-router";
import { BrandedCard, BrandedCardPage } from "@langwatch/design-system/branded-card";
import { type ProjectFormData, TechStackSelector } from "@langwatch/onboarding-browser-kit";
import { useEffect } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";

import { api } from "../../../behavior/onboarding-api.ts";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";
import { useRequiredSession } from "../../../behavior/use-required-session.ts";
import { getSafeReturnToPath } from "../../../model/get-safe-return-to-path.ts";
import { useOnboardingHost } from "../../../model/onboarding-host.ts";
import ErrorPage from "../../../ui/elements/compat/next-error.tsx";

/** The sign-in doors' label voice: small mono capitals. Reaches the tech stack's labels too. */
const FIELD_LABELS = {
  "& [data-scope=field][data-part=label]": {
    fontFamily: "mono",
    fontSize: "11px",
    fontWeight: "normal",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "fg.muted",
    marginBottom: "4px",
  },
} as const;

/** 16px on a phone: anything smaller makes iOS zoom in when the field takes focus. */
const FIELD_TEXT = { base: "16px", md: "14px" } as const;

function submitButtonLabel({ isSuccess, isPending }: { isSuccess: boolean; isPending: boolean }) {
  if (isSuccess) return "Created";
  if (isPending) return "Loading...";
  return "Next";
}

export default function ProjectOnboarding() {
  useRequiredSession();
  const host = useOnboardingHost();

  const form = useForm<ProjectFormData>({
    defaultValues: {
      language: "python",
      framework: "openai",
    },
  });
  const { watch } = form;
  const teamId = watch("teamId");

  const router = useRouter();
  const { organization } = useOrganizationTeamProject({
    redirectToProjectOnboarding: false,
  });

  const { team: teamSlug } = router.query;
  const team = api.team.getBySlug.useQuery(
    {
      slug: typeof teamSlug === "string" ? teamSlug : "",
      organizationId: organization?.id ?? "",
    },
    { enabled: !!organization },
  );
  const teams = api.team.getTeamsWithMembers.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization },
  );
  const safeReturnToPath = getSafeReturnToPath(router.query.return_to);

  useEffect(() => {
    if (team.data) {
      form.setValue("teamId", team.data.id);
    }
  }, [form, team.data]);

  const createProject = api.project.create.useMutation();
  const utils = api.useUtils();

  const onSubmit: SubmitHandler<ProjectFormData> = (data: ProjectFormData) => {
    if (!team.data) return;

    createProject.mutate(
      {
        organizationId: organization?.id ?? "",
        name: data.name,
        teamId: data.teamId === "NEW" ? undefined : data.teamId,
        newTeamName: data.newTeamName,
        language: data.language,
        framework: data.framework,
      },
      {
        onSuccess: async (data) => {
          // The cached graph predates the project; unrefreshed, its address
          // resolves to the previously open project instead.
          await utils.organization.getAll.invalidate();
          if (safeReturnToPath) {
            void router.push(safeReturnToPath);
            return;
          }

          void router.push(`/${data.projectSlug}`);
        },
      },
    );
  };

  if (team.isFetched && !team.data) {
    return <ErrorPage statusCode={404} />;
  }

  return (
    <BrandedCardPage>
      <BrandedCard
        title="Create New Project"
        intro="You can set up separate projects for each service or LLM feature of your application (for example, one for your ChatBot, another for that Content Generation feature)."
        footer={
          <Button
            variant="plain"
            size="xs"
            color="fg.muted"
            _hover={{ color: "fg" }}
            onClick={() => host.signOut()}
          >
            Sign out
          </Button>
        }
      >
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <VStack gap="18px" align="stretch" css={FIELD_LABELS}>
            <Field.Root>
              <Field.Label>Project Name</Field.Label>
              <Input
                size="lg"
                fontSize={FIELD_TEXT}
                borderRadius="10px"
                data-testid="onboarding-project-name"
                {...form.register("name", { required: true })}
              />
            </Field.Root>
            {teams.data?.some((team) => team.projects.length > 0) && (
              <>
                <Field.Root>
                  <Field.Label>Team</Field.Label>
                  <NativeSelect.Root size="lg">
                    <NativeSelect.Field
                      fontSize={FIELD_TEXT}
                      borderRadius="10px"
                      {...form.register("teamId", { required: true })}
                    >
                      {teams.data?.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                      <option value="NEW">(+) Create new team</option>
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Field.Root>
                {teamId === "NEW" && (
                  <Field.Root>
                    <Field.Label>New Team Name</Field.Label>
                    <Input
                      size="lg"
                      fontSize={FIELD_TEXT}
                      borderRadius="10px"
                      {...form.register("newTeamName", { required: true })}
                    />
                  </Field.Root>
                )}
              </>
            )}
            <TechStackSelector
              form={form}
              language={form.watch("language")}
              framework={form.watch("framework")}
            />
            {createProject.error && (
              <Text role="alert" fontSize="12.5px" color="fg.error">
                Something went wrong!
              </Text>
            )}
            <Button
              colorPalette="orange"
              type="submit"
              width="full"
              minHeight="44px"
              fontWeight={600}
              borderRadius="full"
              data-testid="onboarding-project-submit"
              disabled={createProject.isPending || createProject.isSuccess}
            >
              {submitButtonLabel(createProject)}
            </Button>
          </VStack>
        </form>
      </BrandedCard>
    </BrandedCardPage>
  );
}
