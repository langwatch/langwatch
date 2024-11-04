import { HStack, Text, Link } from "@chakra-ui/react";
import { ExternalLink } from "react-feather";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import Mustache from "mustache";

export const MetadataTag = ({
  label,
  value,
}: {
  label: string;
  value: string;
}) => {
  const { project } = useOrganizationTeamProject();

  if (label === "user_id" && project?.userLinkTemplate) {
    const renderedValue = Mustache.render(project?.userLinkTemplate ?? "", {
      user_id: value,
    });

    value = renderedValue;
  }

  return (
    <HStack gap={0} fontSize={"smaller"} margin={0}>
      <Text
        borderWidth={1}
        borderColor={"gray.200"}
        paddingX={2}
        borderLeftRadius={"md"}
      >
        {label}:
      </Text>
      <Text
        borderWidth={1}
        borderColor={"gray.200"}
        paddingX={2}
        borderLeft={"none"}
        backgroundColor={"gray.100"}
        borderRightRadius={"md"}
        fontFamily="mono"
      >
        {value.startsWith("http") ? (
          <HStack gap={1} color="blue.500">
            <Link href={value} target="_blank">
              {value}
            </Link>
            <ExternalLink size={12} />
          </HStack>
        ) : (
          value
        )}
      </Text>
    </HStack>
  );
};
