export function cliUserTokensIndexKey(userId: string): string {
  return `lwcli:user:${userId}:tokens`;
}

export function cliAccessTokenKey(token: string): string {
  return `lwcli:access:${token}`;
}

export function cliRefreshTokenKey(token: string): string {
  return `lwcli:refresh:${token}`;
}
