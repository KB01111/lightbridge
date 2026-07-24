export async function switchToSurface(surface: 'main' | 'settings' | 'orb') {
  await browser.waitUntil(
    async () => {
      for (const handle of await browser.getWindowHandles()) {
        await browser.switchToWindow(handle);
        const label = await browser.execute(
          () => document.documentElement.dataset.surface,
        );
        if (label === surface) return true;
      }
      return false;
    },
    {
      timeout: 10_000,
      timeoutMsg: `The ${surface} surface was not created.`,
    },
  );
}
