export function Icon({ icon }: { icon?: string; size?: number | string; color?: string; iconType?: string }) {
  return <span data-mdx="icon" data-icon={icon} aria-hidden="true" />;
}
