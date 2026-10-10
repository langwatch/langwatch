import { Alert, Button } from "@langwatch/design-system/primitives";

export interface ImpersonationBannerProps {
  /**
   * What "Stop" does. The banner draws the state and names the action; ending
   * the impersonation is a session write, so the mounting feature performs it
   * and decides where the reader lands afterwards.
   */
  onStop: () => void;
  user: {
    name?: string | null;
    email?: string | null;
    impersonator?: {
      id: string;
      name?: string | null;
      email?: string | null;
    } | null;
  };
}

export const ImpersonationBanner = ({ onStop, user }: ImpersonationBannerProps) => {
  if (!user.impersonator) return null;

  return (
    <Alert.Root status="info" size="sm" width="auto" as="output">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title lineClamp={1}>
          Impersonating {user.name ?? user.email ?? "unknown user"}
        </Alert.Title>
      </Alert.Content>
      <Button size="xs" variant="outline" onClick={onStop}>
        Stop
      </Button>
    </Alert.Root>
  );
};
