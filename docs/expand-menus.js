const expandables = ["SDKs"];
const expanded = [];

const expandAllGroups = () => {
  const groups = document.querySelectorAll(".group");

  // biome-ignore lint/complexity/noForEach: <explanation>
  groups.forEach((group) => {
    const isExpandable = group.tagName === 'DIV';
    const text = group.querySelector('div')?.textContent?.trim() || group.textContent.trim();

    if (isExpandable && expandables.includes(text) && !expanded.includes(group)) {
      console.log(`Expanding: ${text}`);

      // Get React props
      const reactProps = getReactProps(group);
      if (reactProps && reactProps.onClick) {
        console.log('Found React onClick, calling with modified parameters');

        // We need to modify the router context temporarily
        // The 'c' variable in their onClick is the Next.js router
        // Let's try to intercept the router.push call

        // First, let's try to find the router instance
        const router = window.next?.router || window.__NEXT_DATA__?.router;
        if (router && router.push) {
          const originalPush = router.push;

          // Temporarily disable router.push
          router.push = () => {
            console.log('Blocked router.push during expansion');
            return Promise.resolve();
          };

          // Call the React onClick
          reactProps.onClick({
            preventDefault: () => {},
            stopPropagation: () => {}
          });

          // Restore router.push after a short delay
          setTimeout(() => {
            router.push = originalPush;
          }, 10);
        } else {
          // Fallback: try to modify the context by creating a fake event
          // that makes the conditions fail
          const fakeEvent = {
            preventDefault: () => {},
            stopPropagation: () => {},
            // Try to make it look like mobile to skip navigation
            target: { closest: () => null },
            currentTarget: group
          };

          reactProps.onClick(fakeEvent);
        }
      } else {
        // Last resort fallback
        group.click();
      }

      expanded.push(group);
    }
  });

  setTimeout(() => {
    const newGroups = document.querySelectorAll(".group");
    if (newGroups.length > groups.length) {
      expandAllGroups();
    }
  }, 0);
};

// Helper function to get React props
const getReactProps = (element) => {
  const key = Object.keys(element).find(key =>
    key.startsWith('__reactProps') ||
    key.startsWith('__reactInternalInstance') ||
    key.startsWith('__reactInternalFiber')
  );
  return key ? element[key] : null;
};

expandAllGroups();
