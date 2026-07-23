describe('LightBridge native overlay', () => {
  it('completes privacy onboarding and exposes responsive core surfaces', async () => {
    await browser.setWindowSize(400, 720);

    const privacyTitle = await $(
      '//*[normalize-space(text())="Your screen stays private until Send"]',
    );
    await privacyTitle.waitForDisplayed();
    await $('//button[contains(normalize-space(.), "I understand")]').click();
    await privacyTitle.waitForDisplayed({ reverse: true });

    const expand = await $('button[aria-label="Expand"]');
    await expand.waitForDisplayed();
    await expand.click();
    await expect($('button[aria-label="Collapse"]')).toBeDisplayed();

    await $('button[aria-label="Settings"]').click();
    await expect(
      $('//*[contains(normalize-space(.), "Default answer quality")]'),
    ).toBeDisplayed();
    await $('button[aria-label="Close"]').click();

    await $('button[aria-label="History and captures"]').click();
    await expect(
      $('//*[contains(normalize-space(.), "History and context")]'),
    ).toBeDisplayed();
    await expect(
      $('//button[contains(normalize-space(.), "Captures")]'),
    ).toBeDisplayed();
    await expect(
      $('//button[contains(normalize-space(.), "Search")]'),
    ).toBeDisplayed();
  });
});
