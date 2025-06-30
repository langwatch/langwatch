import { HStack } from "@chakra-ui/react";
import { RandomColorAvatar } from "../RandomColorAvatar";
import type { AnnotationWithUser } from "./AnnotationsTable";

type User = {
  id: string;
  name: string | null;
};

const UserAvatarGroup = ({
  createdByUser,
  annotations,
}: {
  createdByUser: User | null;
  annotations: AnnotationWithUser[];
}) => {
  const userMap = new Map<string, User>();

  if (createdByUser) {
    userMap.set(createdByUser.id, createdByUser);
  }

  annotations.forEach((annotation) => {
    if (annotation.user) {
      userMap.set(annotation.user.id, annotation.user);
    }
  });

  return (
    <HStack gap={0}>
      {Array.from(userMap.values()).map((user, index) => (
        <RandomColorAvatar
          key={user.id}
          size="2xs"
          name={user.name ?? ""}
          css={{
            border: "2px solid white",
            "&:not(:first-of-type)": {
              marginLeft: "-20px",
            },
          }}
        />
      ))}
    </HStack>
  );
};

export default UserAvatarGroup;
