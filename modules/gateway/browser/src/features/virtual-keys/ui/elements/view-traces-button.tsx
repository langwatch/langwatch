import { Button } from "@chakra-ui/react";
import { Bird } from "lucide-react";
import { Link } from "../../../../ui/elements/gateway-link.tsx";

/**
 * Opens the Trace Explorer filtered to one virtual key's traces. Rendered
 * only when the key has a live, reachable trace destination, so its mere
 * presence answers "can I see this key's traces" without a click.
 */
export function ViewTracesButton({ href }: { href: string }) {
  return (
    <Button asChild size="xs" variant="outline" data-testid="vk-view-traces">
      <Link href={href}>
        <Bird size={14} aria-hidden /> View traces
      </Link>
    </Button>
  );
}
